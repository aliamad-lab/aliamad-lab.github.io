/**
 * Agent de service — rend l'application installable et utilisable hors ligne.
 *
 * Deux raisons d'exister, toutes deux nécessaires au cahier des charges :
 *   1. Android n'autorise l'ajout à l'écran d'accueil, et donc l'usage de
 *      l'application comme cible de partage (§7), que si un agent de service
 *      intercepte les requêtes réseau.
 *   2. La coquille de l'application est mise en cache, si bien qu'ouvrir
 *      l'outil est instantané. L'enrichissement demande évidemment le réseau,
 *      mais le formulaire s'affiche immédiatement — ce qui compte quand la
 *      contrainte est de quinze secondes.
 */

const CACHE = 'veille-coquille-v3';

/**
 * Délai au-delà duquel on préfère la version en cache.
 *
 * Assez court pour que l'ouverture reste immédiate sur un réseau lent ou
 * absent, assez long pour qu'une connexion normale serve toujours la version
 * à jour.
 */
const DELAI_RESEAU = 1500;

// La coquille : tout ce qui ne dépend pas du réseau pour s'afficher.
const COQUILLE = [
  './',
  './index.html',
  './styles.css',
  './dist/app-V4HOG7JK.js',
  './manifest.json',
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(COQUILLE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches
      .keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return;

  const url = new URL(requete.url);

  // Les appels aux API bibliographiques et à GitHub ne sont jamais servis
  // depuis le cache : une réponse périmée produirait une fiche fausse, ou
  // pire, ferait croire à un enregistrement qui n'a pas eu lieu.
  if (url.origin !== self.location.origin) return;

  // Réseau d'abord, cache en secours.
  //
  // L'inverse — cache d'abord, rafraîchissement en arrière-plan — rendait
  // l'application systématiquement en retard d'une version : après une
  // correction, le premier lancement servait encore l'ancien code, et il
  // fallait fermer puis rouvrir pour obtenir le nouveau. Impossible à
  // deviner pour qui utilise l'outil, et source de « ça ne marche toujours
  // pas » parfaitement fondés.
  //
  // Le coût est une attente d'au plus 1,5 s à l'ouverture ; passé ce délai,
  // ou hors ligne, le cache prend le relais et l'application s'affiche
  // instantanément.
  evenement.respondWith(
    (async () => {
      const enCache = await caches.match(requete);

      const reseau = fetch(requete)
        .then((reponse) => {
          if (reponse.ok) {
            const copie = reponse.clone();
            caches.open(CACHE).then((cache) => cache.put(requete, copie));
          }
          return reponse;
        });

      if (!enCache) return reseau;

      // On laisse le réseau gagner s'il répond vite, sinon on sert le cache
      // sans annuler la requête : elle mettra le cache à jour pour la fois
      // suivante.
      const minuterie = new Promise((resoudre) => setTimeout(() => resoudre(null), DELAI_RESEAU));
      const gagnant = await Promise.race([reseau.catch(() => null), minuterie]);
      return gagnant ?? enCache;
    })(),
  );
});
