/* Lubayd SA - Firebase / Cloud Firestore */
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

  try {
    if (!window.firebase) throw new Error('Firebase SDK no disponible');
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();

    // Firestore conserva una copia local y sincroniza al recuperar internet.
    db.enablePersistence({ synchronizeTabs: true }).catch(function (error) {
      if (error.code !== 'failed-precondition' && error.code !== 'unimplemented') {
        console.warn('Persistencia Firestore:', error);
      }
    });

    const collection = db.collection('partes');

    window.LubaydCloud = {
      available: true,
      subscribe(onData, onError) {
        return collection.onSnapshot({ includeMetadataChanges: true }, function (snapshot) {
          const records = snapshot.docs.map(function (doc) {
            return Object.assign({ id: doc.id }, doc.data());
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
        return collection.doc(record.id).set(record, { merge: true });
      },
      remove(id) {
        return collection.doc(id).delete();
      },
      async migrate(records) {
        if (!records || !records.length) return;
        const chunks = [];
        for (let i = 0; i < records.length; i += 400) chunks.push(records.slice(i, i + 400));
        for (const chunk of chunks) {
          const batch = db.batch();
          chunk.forEach(function (record) {
            if (record && record.id) batch.set(collection.doc(record.id), record, { merge: true });
          });
          await batch.commit();
        }
      }
    };

    window.dispatchEvent(new CustomEvent('lubayd-cloud-ready'));
  } catch (error) {
    console.error('Firebase:', error);
    window.LubaydCloud = { available: false, error: error };
    window.dispatchEvent(new CustomEvent('lubayd-cloud-error', { detail: error }));
  }
})();
