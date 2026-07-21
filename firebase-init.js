/* Lubayd SA V20 - Firebase Authentication, Firestore, asistencia y notificaciones push */
(function () {
  const firebaseConfig = {
    apiKey: "AIzaSyCQDwcbAox4QEDe_czZX_YSd9jVx9g5BkY",
    authDomain: "lubayd-sa.firebaseapp.com",
    projectId: "lubayd-sa",
    storageBucket: "lubayd-sa.firebasestorage.app",
    messagingSenderId: "916029913982",
    appId: "1:916029913982:web:cc4e5b02b8b8055171d12f",
    measurementId: "G-LVP0TWS84N"
  };

  function normalizeFirestoreValue(value) {
    if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
    if (Array.isArray(value)) return value.map(normalizeFirestoreValue);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(function (entry) {
        return [entry[0], normalizeFirestoreValue(entry[1])];
      }));
    }
    return value;
  }

  function authErrorMessage(error) {
    const messages = {
      'auth/invalid-email': 'El correo electrónico no es válido.',
      'auth/missing-password': 'Ingresa la contraseña.',
      'auth/invalid-credential': 'Correo o contraseña incorrectos.',
      'auth/user-not-found': 'No existe una cuenta con ese correo.',
      'auth/wrong-password': 'La contraseña es incorrecta.',
      'auth/email-already-in-use': 'Ya existe una cuenta con ese correo.',
      'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
      'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos y vuelve a probar.',
      'auth/network-request-failed': 'No se pudo conectar con Firebase. Revisa internet.',
      'auth/operation-not-allowed': 'Debes habilitar el acceso por correo y contraseña en Firebase Authentication.',
      'permission-denied': 'Firebase rechazó la operación. Publica las reglas incluidas en esta versión.'
    };
    return messages[error && error.code] || (error && error.message) || 'No se pudo completar la operación.';
  }

  function safeName(profile, user) {
    return String(profile?.nombre || user?.displayName || user?.email || 'Usuario').trim();
  }

  try {
    if (!window.firebase) throw new Error('Firebase SDK no disponible');
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

    const auth = firebase.auth();
    const db = firebase.firestore();
    const FieldValue = firebase.firestore.FieldValue;
    const Timestamp = firebase.firestore.Timestamp;
    const serverTimestamp = FieldValue.serverTimestamp;

    auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(function (error) {
      console.warn('Persistencia de sesión:', error);
    });

    db.enablePersistence({ synchronizeTabs: true }).catch(function (error) {
      if (error.code !== 'failed-precondition' && error.code !== 'unimplemented') {
        console.warn('Persistencia Firestore:', error);
      }
    });

    const partesCollection = db.collection('partes');
    const usersCollection = db.collection('usuarios');
    const chatsCollection = db.collection('chats');
    const attendanceCollection = db.collection('asistencias');
    const attendancePhotosCollection = db.collection('asistencia_fotos');
    const attendanceAuditCollection = db.collection('asistencia_auditoria');

    window.LubaydAuth = {
      available: true,
      currentUser() {
        return auth.currentUser;
      },
      currentProfile() {
        return window.LubaydCurrentProfile || null;
      },
      async login(email, password) {
        const credential = await auth.signInWithEmailAndPassword(String(email || '').trim(), password);
        return credential.user;
      },
      async register(name, email, password) {
        window.LubaydRegistrationInProgress = true;
        try {
          const credential = await auth.createUserWithEmailAndPassword(String(email || '').trim(), password);
          const cleanName = String(name || '').trim();
          if (cleanName) await credential.user.updateProfile({ displayName: cleanName });
          await usersCollection.doc(credential.user.uid).set({
            nombre: cleanName || credential.user.email || 'Usuario',
            email: credential.user.email || '',
            active: true,
            role: 'operador',
            createdAt: serverTimestamp()
          });
          await credential.user.reload();
          window.LubaydCurrentUser = auth.currentUser;
          return auth.currentUser;
        } finally {
          window.LubaydRegistrationInProgress = false;
          window.dispatchEvent(new CustomEvent('lubayd-auth-changed', { detail: { user: auth.currentUser } }));
        }
      },
      async getProfile(user) {
        if (!user) return null;
        const reference = usersCollection.doc(user.uid);
        let snapshot = await reference.get();
        if (!snapshot.exists) {
          await reference.set({
            nombre: user.displayName || user.email || 'Usuario',
            email: user.email || '',
            active: true,
            role: 'operador',
            createdAt: serverTimestamp()
          });
          snapshot = await reference.get();
        }
        return Object.assign({ uid: user.uid }, normalizeFirestoreValue(snapshot.data() || {}));
      },
      async resetPassword(email) {
        return auth.sendPasswordResetEmail(String(email || '').trim());
      },
      async logout() {
        try {
          if (window.LubaydPush && typeof window.LubaydPush.disable === 'function') {
            await window.LubaydPush.disable({ keepPermission: true });
          }
        } catch (error) {
          console.warn('No se pudo retirar el dispositivo antes de cerrar sesión:', error);
        }
        return auth.signOut();
      },
      errorMessage: authErrorMessage
    };

    window.LubaydCloud = {
      available: true,
      subscribe(onData, onError) {
        if (!auth.currentUser) throw new Error('Debes iniciar sesión para sincronizar.');
        return partesCollection.onSnapshot({ includeMetadataChanges: true }, function (snapshot) {
          const records = snapshot.docs.map(function (doc) {
            return Object.assign({ id: doc.id }, normalizeFirestoreValue(doc.data()));
          }).sort(function (a, b) {
            return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
          });
          onData(records, {
            fromCache: snapshot.metadata.fromCache,
            hasPendingWrites: snapshot.metadata.hasPendingWrites
          });
        }, onError);
      },
      save(record) {
        const user = auth.currentUser;
        if (!user) return Promise.reject(new Error('Debes iniciar sesión.'));
        if (!record) return Promise.reject(new Error('No se recibió el parte.'));

        const payload = Object.assign({}, record, {
          createdByUid: user.uid,
          createdByEmail: user.email || '',
          createdByName: user.displayName || user.email || 'Usuario',
          createdAtServer: serverTimestamp()
        });

        if (record.gps) {
          payload.gps = Object.assign({}, record.gps, {
            capturedAtServer: serverTimestamp()
          });
        } else {
          payload.gps = null;
        }

        return partesCollection.doc(record.id).set(payload);
      },
      remove(id) {
        if (!auth.currentUser) return Promise.reject(new Error('Debes iniciar sesión.'));
        return partesCollection.doc(id).delete();
      }
    };

    window.LubaydChat = {
      available: true,
      subscribeUsers(profile, onData, onError) {
        if (!auth.currentUser) throw new Error('Debes iniciar sesión.');
        const query = profile?.role === 'admin'
          ? usersCollection
          : usersCollection.where('role', '==', 'admin');
        return query.onSnapshot(function (snapshot) {
          const users = snapshot.docs.map(function (doc) {
            return Object.assign({ uid: doc.id }, normalizeFirestoreValue(doc.data()));
          }).filter(function (user) {
            return user.active === true && user.uid !== auth.currentUser.uid;
          }).sort(function (a, b) {
            return String(a.nombre || a.email || '').localeCompare(String(b.nombre || b.email || ''), 'es');
          });
          onData(users);
        }, onError);
      },
      subscribeConversations(onData, onError) {
        if (!auth.currentUser) throw new Error('Debes iniciar sesión.');
        return chatsCollection.where('participants', 'array-contains', auth.currentUser.uid)
          .onSnapshot(function (snapshot) {
            const conversations = snapshot.docs.map(function (doc) {
              return Object.assign({ id: doc.id }, normalizeFirestoreValue(doc.data()));
            }).sort(function (a, b) {
              return String(b.lastMessageAtClient || b.createdAtClient || '')
                .localeCompare(String(a.lastMessageAtClient || a.createdAtClient || ''));
            });
            onData(conversations);
          }, onError);
      },
      async ensureConversation(peer, profile) {
        const user = auth.currentUser;
        if (!user || !peer || !profile) throw new Error('No se pudo identificar a los participantes.');

        const currentIsAdmin = profile.role === 'admin';
        const admin = currentIsAdmin
          ? { uid: user.uid, nombre: safeName(profile, user), email: user.email || '', role: 'admin' }
          : peer;
        const operator = currentIsAdmin
          ? peer
          : { uid: user.uid, nombre: safeName(profile, user), email: user.email || '', role: profile.role || 'operador' };

        if (admin.role !== 'admin') throw new Error('No hay un administrador configurado para el chat.');
        if (admin.uid === operator.uid) throw new Error('No puedes iniciar una conversación contigo mismo.');

        const id = [admin.uid, operator.uid].sort().join('__');
        const reference = chatsCollection.doc(id);
        const snapshot = await reference.get();
        const now = new Date().toISOString();

        if (!snapshot.exists) {
          await reference.set({
            participants: [admin.uid, operator.uid],
            adminUid: admin.uid,
            adminName: admin.nombre || admin.email || 'Administrador',
            adminEmail: admin.email || '',
            operatorUid: operator.uid,
            operatorName: operator.nombre || operator.email || 'Operador',
            operatorEmail: operator.email || '',
            lastMessage: '',
            lastMessageAt: serverTimestamp(),
            lastMessageAtClient: now,
            lastSenderId: '',
            unreadByAdmin: 0,
            unreadByOperator: 0,
            createdAt: serverTimestamp(),
            createdAtClient: now
          });
        }

        const latest = await reference.get();
        return Object.assign({ id }, normalizeFirestoreValue(latest.data() || {}));
      },
      subscribeMessages(chatId, onData, onError) {
        if (!auth.currentUser || !chatId) throw new Error('Conversación no disponible.');
        return chatsCollection.doc(chatId).collection('mensajes')
          .orderBy('createdAtClient', 'asc')
          .onSnapshot(function (snapshot) {
            const messages = snapshot.docs.map(function (doc) {
              return Object.assign({ id: doc.id }, normalizeFirestoreValue(doc.data()));
            });
            onData(messages);
          }, onError);
      },
      async sendMessage(chatId, text) {
        const user = auth.currentUser;
        const cleanText = String(text || '').trim();
        if (!user) throw new Error('Debes iniciar sesión.');
        if (!chatId) throw new Error('Selecciona una conversación.');
        if (!cleanText) throw new Error('Escribe un mensaje.');
        if (cleanText.length > 1000) throw new Error('El mensaje supera los 1000 caracteres.');

        const chatRef = chatsCollection.doc(chatId);
        const chatSnapshot = await chatRef.get();
        if (!chatSnapshot.exists) throw new Error('La conversación no existe.');
        const chat = chatSnapshot.data();
        if (!Array.isArray(chat.participants) || !chat.participants.includes(user.uid)) {
          throw new Error('No tienes acceso a esta conversación.');
        }

        const receiverId = chat.participants.find(function (uid) { return uid !== user.uid; });
        const ownIsAdmin = chat.adminUid === user.uid;
        const now = new Date().toISOString();
        const messageRef = chatRef.collection('mensajes').doc();
        const batch = db.batch();

        batch.set(messageRef, {
          text: cleanText,
          senderId: user.uid,
          receiverId: receiverId,
          createdAt: serverTimestamp(),
          createdAtClient: now
        });

        const chatUpdate = {
          lastMessage: cleanText.slice(0, 160),
          lastMessageAt: serverTimestamp(),
          lastMessageAtClient: now,
          lastSenderId: user.uid
        };
        if (ownIsAdmin) {
          chatUpdate.unreadByAdmin = 0;
          chatUpdate.unreadByOperator = FieldValue.increment(1);
        } else {
          chatUpdate.unreadByOperator = 0;
          chatUpdate.unreadByAdmin = FieldValue.increment(1);
        }
        batch.set(chatRef, chatUpdate, { merge: true });
        await batch.commit();
      },
      async markRead(chatId) {
        const user = auth.currentUser;
        if (!user || !chatId) return;
        const reference = chatsCollection.doc(chatId);
        const snapshot = await reference.get();
        if (!snapshot.exists) return;
        const chat = snapshot.data();
        if (!Array.isArray(chat.participants) || !chat.participants.includes(user.uid)) return;
        const field = chat.adminUid === user.uid ? 'unreadByAdmin' : 'unreadByOperator';
        if (Number(chat[field] || 0) > 0) await reference.set({ [field]: 0 }, { merge: true });
      }
    };


    function requireAuthenticated() {
      if (!auth.currentUser) throw new Error('Debes iniciar sesión.');
      return auth.currentUser;
    }

    function requireAdmin() {
      const user = requireAuthenticated();
      const profile = window.LubaydCurrentProfile || {};
      if (profile.role !== 'admin') throw new Error('Esta acción requiere permisos de administrador.');
      return user;
    }

    function requireOperator() {
      const user = requireAuthenticated();
      const profile = window.LubaydCurrentProfile || {};
      if (profile.role !== 'operador') throw new Error('Solo los operadores pueden registrar llegada y salida.');
      return user;
    }

    function uruguayWallTimeToDate(dateKey, timeText) {
      const parts = String(dateKey || '').split('-').map(Number);
      const time = String(timeText || '').split(':').map(Number);
      if (parts.length !== 3 || time.length !== 2 || parts.some(Number.isNaN) || time.some(Number.isNaN)) throw new Error('No se pudo interpretar el horario.');
      const [year, month, day] = parts;
      const [hour, minute] = time;
      if (hour > 23 || minute > 59) throw new Error('El horario no es válido.');
      const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
      const zoneParts = date => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Montevideo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
      const offsetFor = date => { const value = zoneParts(date); return Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day), Number(value.hour), Number(value.minute), Number(value.second)) - date.getTime(); };
      let result = new Date(guess.getTime() - offsetFor(guess));
      result = new Date(guess.getTime() - offsetFor(result));
      return result;
    }

    function normalizeDocument(doc) {
      return Object.assign({ id: doc.id }, normalizeFirestoreValue(doc.data() || {}));
    }


    window.LubaydAttendanceData = {
      available: true,
      subscribe(profile, onData, onError) {
        const user = requireAuthenticated();
        const canSeeTeam = profile?.role === 'admin' || profile?.role === 'supervisor';
        const query = canSeeTeam
          ? attendanceCollection
          : attendanceCollection.where('userId', '==', user.uid);
        return query.onSnapshot({ includeMetadataChanges: true }, function (snapshot) {
          const records = snapshot.docs.map(normalizeDocument).sort(function (a, b) {
            const dateCompare = String(b.dateKey || '').localeCompare(String(a.dateKey || ''));
            if (dateCompare) return dateCompare;
            return String(b.entryAtClient || '').localeCompare(String(a.entryAtClient || ''));
          });
          onData(records, {
            fromCache: snapshot.metadata.fromCache,
            hasPendingWrites: snapshot.metadata.hasPendingWrites,
            teamMode: canSeeTeam
          });
        }, onError);
      },
      async getRecord(dateKey) {
        const user = requireAuthenticated();
        const snapshot = await attendanceCollection.doc(`${user.uid}_${dateKey}`).get();
        return snapshot.exists ? normalizeDocument(snapshot) : null;
      },
      async getPhotoUrl(photoId) {
        requireAuthenticated();
        if (!photoId) throw new Error('La fotografía no está disponible.');
        const reference = attendancePhotosCollection.doc(photoId);
        let snapshot;
        if (navigator.onLine) {
          try {
            snapshot = await reference.get({ source: 'server' });
          } catch (serverError) {
            try {
              snapshot = await reference.get({ source: 'cache' });
            } catch (_) {
              throw serverError;
            }
          }
        } else {
          snapshot = await reference.get({ source: 'cache' });
        }
        if (!snapshot.exists) throw new Error('No se encontró la fotografía en Firebase ni en la caché del dispositivo.');
        const data = snapshot.data() || {};
        if (typeof data.imageData !== 'string' || !data.imageData.startsWith('data:image/')) {
          throw new Error('La fotografía guardada está vacía o tiene un formato inválido.');
        }
        return data.imageData;
      },
      async registerQueued(item) {
        const user = requireOperator();
        const profile = window.LubaydCurrentProfile || {};
        const type = item?.type === 'exit' ? 'exit' : 'entry';
        const dateKey = String(item?.dateKey || '').trim();
        const imageData = String(item?.imageData || '');
        const photoId = String(item?.photoId || '').trim();
        const attendanceId = String(item?.attendanceId || `${user.uid}_${dateKey}`);
        const capturedAtClient = String(item?.capturedAt || '').trim();
        const clientMutationId = String(item?.clientMutationId || '').trim();
        const gps = item?.gps;
        if (item?.userId !== user.uid) throw new Error('La marca pertenece a otro usuario.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('La fecha de asistencia no es válida.');
        if (!photoId || !clientMutationId) throw new Error('La marca no tiene un identificador local válido.');
        if (!imageData.startsWith('data:image/jpeg;base64,') || imageData.length < 100 || imageData.length >= 700000) throw new Error('La fotografía no tiene un formato o tamaño válido.');
        const capturedDate = new Date(capturedAtClient);
        if (Number.isNaN(capturedDate.getTime())) throw new Error('La hora guardada en el teléfono no es válida.');
        if (!gps || !Number.isFinite(Number(gps.latitude)) || !Number.isFinite(Number(gps.longitude))) throw new Error('No se pudo validar la ubicación GPS.');

        const documentRef = attendanceCollection.doc(attendanceId);
        const photoRef = attendancePhotosCollection.doc(photoId);
        const capturedAt = Timestamp.fromDate(capturedDate);
        const nowClient = new Date().toISOString();
        const gpsPayload = {
          latitude: Number(gps.latitude),
          longitude: Number(gps.longitude),
          accuracy: Math.max(0, Number(gps.accuracy || 0)),
          capturedAtClient: String(gps.capturedAtClient || capturedAtClient)
        };

        await db.runTransaction(async transaction => {
          const snapshot = await transaction.get(documentRef);
          const data = snapshot.exists ? (snapshot.data() || {}) : {};
          const existingMutation = type === 'entry' ? data.entryClientMutationId : data.exitClientMutationId;
          const existingPhoto = type === 'entry' ? data.entryPhotoId : data.exitPhotoId;
          if (existingMutation === clientMutationId || existingPhoto === photoId) return;

          const photoPayload = {
            ownerId: user.uid,
            attendanceId,
            kind: type,
            mimeType: 'image/jpeg',
            imageData,
            capturedAt,
            capturedAtClient,
            clientMutationId,
            offlineCaptured: Boolean(item?.offlineCaptured),
            createdAt: serverTimestamp()
          };

          if (type === 'entry') {
            if (snapshot.exists) throw new Error('La llegada de ese día ya fue registrada.');
            transaction.set(photoRef, photoPayload);
            transaction.set(documentRef, {
              userId: user.uid,
              userName: safeName(profile, user),
              userEmail: user.email || '',
              dateKey,
              status: 'trabajando',
              entryAt: capturedAt,
              entryAtClient: capturedAtClient,
              entryPhotoId: photoId,
              entryGps: gpsPayload,
              entryClientMutationId: clientMutationId,
              entryOfflineCaptured: Boolean(item?.offlineCaptured),
              entrySyncedAt: serverTimestamp(),
              createdAt: serverTimestamp(),
              createdAtClient: capturedAtClient,
              updatedAt: serverTimestamp(),
              updatedAtClient: nowClient
            });
          } else {
            if (!snapshot.exists) throw new Error('Primero debes sincronizar la llegada.');
            if (data.exitAt || data.exitPhotoId) throw new Error('La salida de ese día ya fue registrada.');
            const entryDate = data.entryAt?.toDate ? data.entryAt.toDate() : new Date(data.entryAtClient || 0);
            if (entryDate && !Number.isNaN(entryDate.getTime()) && capturedDate.getTime() <= entryDate.getTime()) throw new Error('La salida debe ser posterior a la llegada.');
            transaction.set(photoRef, photoPayload);
            transaction.update(documentRef, {
              status: 'finalizado',
              exitAt: capturedAt,
              exitAtClient: capturedAtClient,
              exitPhotoId: photoId,
              exitGps: gpsPayload,
              exitClientMutationId: clientMutationId,
              exitOfflineCaptured: Boolean(item?.offlineCaptured),
              exitSyncedAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              updatedAtClient: nowClient
            });
          }
        });
        const saved = await documentRef.get();
        return saved.exists ? normalizeDocument(saved) : null;
      },
      async register(kind, options) {
        const user = requireOperator();
        const blob = options?.blob;
        if (!(blob instanceof Blob) || !blob.size) throw new Error('Debes tomar una fotografía nueva.');
        const imageData = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('No se pudo procesar la fotografía.'));
          reader.readAsDataURL(blob);
        });
        const type = kind === 'exit' ? 'exit' : 'entry';
        const dateKey = String(options?.dateKey || '').trim();
        const attendanceId = `${user.uid}_${dateKey}`;
        return this.registerQueued({
          attendanceId,
          userId: user.uid,
          userName: safeName(window.LubaydCurrentProfile || {}, user),
          userEmail: user.email || '',
          dateKey,
          type,
          photoId: `${attendanceId}_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          imageData,
          capturedAt: new Date().toISOString(),
          gps: options?.gps,
          clientMutationId: `${user.uid}-${type}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          offlineCaptured: false
        });
      },
      async updateByAdmin(attendanceId, changes) {
        const admin = requireAdmin();
        const reason = String(changes?.reason || '').trim().slice(0, 300);
        const entryTime = String(changes?.entryTime || '').trim();
        const exitTime = String(changes?.exitTime || '').trim();
        if (!attendanceId) throw new Error('Registro de asistencia no válido.');
        if (!/^\d{2}:\d{2}$/.test(entryTime)) throw new Error('La hora de llegada no es válida.');
        if (exitTime && !/^\d{2}:\d{2}$/.test(exitTime)) throw new Error('La hora de salida no es válida.');
        if (!reason) throw new Error('Debes indicar el motivo del cambio.');

        const reference = attendanceCollection.doc(attendanceId);
        const snapshot = await reference.get();
        if (!snapshot.exists) throw new Error('El registro ya no existe.');
        const data = snapshot.data() || {};
        const dateKey = String(data.dateKey || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('La fecha del registro no es válida.');
        if (data.exitAt && !exitTime) throw new Error('Indica la hora de salida o elimina el registro completo.');

        function timestampFor(time) {
          return Timestamp.fromDate(uruguayWallTimeToDate(dateKey, time));
        }

        const entryAt = timestampFor(entryTime);
        const exitAt = exitTime ? timestampFor(exitTime) : null;
        if (exitAt && exitAt.toMillis() <= entryAt.toMillis()) {
          throw new Error('La salida debe ser posterior a la llegada.');
        }

        const nowClient = new Date().toISOString();
        const profile = window.LubaydCurrentProfile || {};
        const updatePayload = {
          entryAt: entryAt,
          entryAtClient: entryAt.toDate().toISOString(),
          status: exitAt ? 'finalizado' : 'trabajando',
          updatedAt: serverTimestamp(),
          correctedAt: serverTimestamp(),
          correctedAtClient: nowClient,
          correctedByUid: admin.uid,
          correctedByName: safeName(profile, admin),
          correctionReason: reason
        };
        if (exitAt) {
          updatePayload.exitAt = exitAt;
          updatePayload.exitAtClient = exitAt.toDate().toISOString();
        }

        const auditReference = attendanceAuditCollection.doc();
        const batch = db.batch();
        batch.update(reference, updatePayload);
        batch.set(auditReference, {
          action: 'update',
          attendanceId: attendanceId,
          userId: data.userId || '',
          userName: data.userName || data.userEmail || 'Usuario',
          dateKey: dateKey,
          beforeEntryAt: data.entryAt || null,
          beforeExitAt: data.exitAt || null,
          afterEntryAt: entryAt,
          afterExitAt: exitAt,
          reason: reason,
          performedByUid: admin.uid,
          performedByName: safeName(profile, admin),
          performedAt: serverTimestamp(),
          performedAtClient: nowClient
        });
        await batch.commit();
      },
      async deleteByAdmin(attendanceId, reasonText) {
        const admin = requireAdmin();
        const reason = String(reasonText || '').trim().slice(0, 300);
        if (!attendanceId) throw new Error('Registro de asistencia no válido.');
        if (!reason) throw new Error('Debes indicar el motivo de la eliminación.');
        const reference = attendanceCollection.doc(attendanceId);
        const snapshot = await reference.get();
        if (!snapshot.exists) throw new Error('El registro ya no existe.');
        const data = snapshot.data() || {};
        const profile = window.LubaydCurrentProfile || {};
        const nowClient = new Date().toISOString();
        const auditReference = attendanceAuditCollection.doc();
        const batch = db.batch();
        batch.set(auditReference, {
          action: 'delete',
          attendanceId: attendanceId,
          userId: data.userId || '',
          userName: data.userName || data.userEmail || 'Usuario',
          userEmail: data.userEmail || '',
          dateKey: data.dateKey || '',
          beforeEntryAt: data.entryAt || null,
          beforeExitAt: data.exitAt || null,
          entryPhotoId: data.entryPhotoId || '',
          exitPhotoId: data.exitPhotoId || '',
          reason: reason,
          performedByUid: admin.uid,
          performedByName: safeName(profile, admin),
          performedAt: serverTimestamp(),
          performedAtClient: nowClient
        });
        if (data.entryPhotoId) batch.delete(attendancePhotosCollection.doc(data.entryPhotoId));
        if (data.exitPhotoId) batch.delete(attendancePhotosCollection.doc(data.exitPhotoId));
        batch.delete(reference);
        await batch.commit();
      }
    };

    window.LubaydOps = {
      available: true,
      subscribeCollection(collectionName, onData, onError, options) {
        requireAuthenticated();
        let query = db.collection(collectionName);
        const opts = options || {};
        if (opts.where && Array.isArray(opts.where)) {
          opts.where.forEach(function (condition) {
            query = query.where(condition[0], condition[1], condition[2]);
          });
        }
        if (opts.orderBy) query = query.orderBy(opts.orderBy, opts.direction || 'desc');
        return query.onSnapshot({ includeMetadataChanges: true }, function (snapshot) {
          const docs = snapshot.docs.map(normalizeDocument);
          onData(docs, {
            fromCache: snapshot.metadata.fromCache,
            hasPendingWrites: snapshot.metadata.hasPendingWrites
          });
        }, onError);
      },
      subscribeUsers(onData, onError) {
        requireAdmin();
        return usersCollection.onSnapshot(function (snapshot) {
          const users = snapshot.docs.map(normalizeDocument).sort(function (a, b) {
            return String(a.nombre || a.email || '').localeCompare(String(b.nombre || b.email || ''), 'es');
          });
          onData(users);
        }, onError);
      },
      async updateUser(uid, patch) {
        const current = requireAdmin();
        if (!uid) throw new Error('Usuario no válido.');
        const allowed = {};
        if (Object.prototype.hasOwnProperty.call(patch || {}, 'active')) allowed.active = Boolean(patch.active);
        if (Object.prototype.hasOwnProperty.call(patch || {}, 'role')) {
          const role = String(patch.role || '').toLowerCase();
          if (!['admin', 'supervisor', 'operador'].includes(role)) throw new Error('Rol no válido.');
          allowed.role = role;
        }
        allowed.updatedAt = serverTimestamp();
        allowed.updatedByUid = current.uid;
        await usersCollection.doc(uid).set(allowed, { merge: true });
      },
      async saveCatalog(collectionName, record, id) {
        requireAdmin();
        if (!['maquinas', 'montes'].includes(collectionName)) throw new Error('Catálogo no válido.');
        const reference = id ? db.collection(collectionName).doc(id) : db.collection(collectionName).doc();
        const payload = Object.assign({}, record, {
          updatedAt: serverTimestamp(),
          updatedAtClient: new Date().toISOString(),
          updatedByUid: auth.currentUser.uid
        });
        if (!id) {
          payload.createdAt = serverTimestamp();
          payload.createdAtClient = new Date().toISOString();
          payload.createdByUid = auth.currentUser.uid;
        }
        await reference.set(payload, { merge: Boolean(id) });
        return reference.id;
      },
      async deleteCatalog(collectionName, id) {
        requireAdmin();
        if (!['maquinas', 'montes'].includes(collectionName)) throw new Error('Catálogo no válido.');
        await db.collection(collectionName).doc(id).delete();
      },
      async createIncident(record) {
        const user = requireAuthenticated();
        const reference = db.collection('incidencias').doc();
        const profile = window.LubaydCurrentProfile || {};
        const now = new Date().toISOString();
        await reference.set(Object.assign({}, record, {
          status: 'abierta',
          createdByUid: user.uid,
          createdByName: profile.nombre || user.displayName || user.email || 'Usuario',
          createdByEmail: user.email || '',
          createdAt: serverTimestamp(),
          createdAtClient: now,
          updatedAt: serverTimestamp(),
          updatedAtClient: now
        }));
        return reference.id;
      },
      async updateIncident(id, patch) {
        const user = requireAuthenticated();
        if (!id) throw new Error('Incidencia no válida.');
        const reference = db.collection('incidencias').doc(id);
        const snapshot = await reference.get();
        if (!snapshot.exists) throw new Error('La incidencia no existe.');
        const data = snapshot.data();
        const profile = window.LubaydCurrentProfile || {};
        if (profile.role !== 'admin' && data.createdByUid !== user.uid) {
          throw new Error('No tienes permisos para modificar esta incidencia.');
        }
        const allowed = {};
        ['status', 'assignedTo', 'resolution', 'priority'].forEach(function (field) {
          if (Object.prototype.hasOwnProperty.call(patch || {}, field)) allowed[field] = patch[field];
        });
        allowed.updatedAt = serverTimestamp();
        allowed.updatedAtClient = new Date().toISOString();
        allowed.updatedByUid = user.uid;
        await reference.set(allowed, { merge: true });
      },
      async deleteIncident(id) {
        requireAdmin();
        await db.collection('incidencias').doc(id).delete();
      },
      async updatePartStatus(id, status, note) {
        const user = requireAdmin();
        const allowedStatus = ['enviado', 'revisado', 'aprobado', 'devuelto'];
        if (!allowedStatus.includes(status)) throw new Error('Estado no válido.');
        await partesCollection.doc(id).set({
          workflowStatus: status,
          workflowNote: String(note || '').slice(0, 500),
          reviewedByUid: user.uid,
          reviewedAt: serverTimestamp(),
          reviewedAtClient: new Date().toISOString()
        }, { merge: true });
      }
    };

    auth.onAuthStateChanged(function (user) {
      window.LubaydCurrentUser = user || null;
      if (!user) window.LubaydCurrentProfile = null;
      if (window.LubaydRegistrationInProgress) return;
      window.dispatchEvent(new CustomEvent('lubayd-auth-changed', { detail: { user: user || null } }));
    });

    window.dispatchEvent(new CustomEvent('lubayd-firebase-ready'));
  } catch (error) {
    console.error('Firebase:', error);
    window.LubaydAuth = { available: false, error: error, errorMessage: authErrorMessage };
    window.LubaydCloud = { available: false, error: error };
    window.LubaydChat = { available: false, error: error };
    window.LubaydOps = { available: false, error: error };
    window.LubaydAttendanceData = { available: false, error: error };
    window.dispatchEvent(new CustomEvent('lubayd-firebase-error', { detail: error }));
  }
})();
