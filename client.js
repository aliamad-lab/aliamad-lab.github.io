/**
 * Recherche et filtrage du site public (§3.6) — le cœur de l'outil.
 *
 * Tout se passe dans le navigateur, sur les données déposées dans la page au
 * moment du build : aucun serveur, aucune requête, aucune latence. À
 * l'échelle visée — quelques milliers de références — un filtre en mémoire
 * est instantané, et cette absence d'index à maintenir est ce qui rend le
 * site increvable.
 *
 * Deux mécanismes complémentaires, comme prévu :
 *   - le filtrage par mots-clés, cumulatif ;
 *   - la recherche plein texte sur titre, résumé et commentaire, parce que
 *     six mois plus tard on se souvient d'une phrase, pas d'un mot-clé.
 */

const FICHES = JSON.parse(document.getElementById('donnees').textContent);

const LIBELLES_TYPE = { article: null, ressource: 'Ressource', guide: 'Guide', evenement: 'Événement' };

const $ = (sel) => document.querySelector(sel);

const echapper = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Clé de comparaison sans diacritiques.
 *
 * « épidémiologie » et « epidemiologie » doivent désigner le même filtre, et
 * taper « ketamine » sans accent doit trouver « kétamine » — ce qui arrive
 * systématiquement quand on cherche depuis un téléphone.
 */
const pliage = (v) => String(v ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Auteurs abrégés : au-delà de trois, on compte le reste. */
function auteursCourts(auteurs) {
  if (!auteurs?.length) return '';
  if (auteurs.length <= 3) return echapper(auteurs.join(', '));
  return echapper(auteurs.slice(0, 3).join(', ')) + ' <i>et al.</i>';
}

/** Notice bibliographique, privée de l'année qui figure en gouttière. */
function ligneSource(f) {
  const bouts = [];
  if (f.revue) bouts.push('<em>' + echapper(f.revue) + '</em>');
  const pagination = [f.volume, f.pages].filter(Boolean).join(' : ');
  if (pagination) bouts.push(echapper(pagination));
  return bouts.join(', ');
}

function liens(f) {
  const sortie = [];
  if (f.doi) sortie.push('<a href="' + echapper(f.lien) + '" rel="noopener">doi</a>');
  if (f.pmid) sortie.push('<a href="https://pubmed.ncbi.nlm.nih.gov/' + echapper(f.pmid) + '/" rel="noopener">pubmed</a>');
  if (f.lien_libre) sortie.push('<a href="' + echapper(f.lien_libre) + '" rel="noopener">accès libre</a>');
  if (!sortie.length && f.lien) sortie.push('<a href="' + echapper(f.lien) + '" rel="noopener">consulter</a>');
  return sortie.join(' · ');
}

function entree(f) {
  const marqueur = LIBELLES_TYPE[f.type] ? '<span class="marqueur">' + echapper(LIBELLES_TYPE[f.type]) + '</span>' : '';
  const mots = (f.tags ?? [])
    .map((t) => '<button type="button" class="mc" data-tag="' + echapper(t) + '">' + echapper(t) + '</button>')
    .join('');
  const notice = ligneSource(f);
  const auteurs = auteursCourts(f.auteurs);

  return `
    <article class="entree">
      <div class="rang">${echapper(String(f.annee ?? 's. d.'))}</div>
      <div>
        <h2 class="titre"><a href="${echapper(f.lien || '#')}" rel="noopener">${echapper(f.titre)}</a>${marqueur}</h2>
        <p class="meta">${auteurs}${auteurs && notice ? ' — ' : ''}${notice}${liens(f) ? ' · ' + liens(f) : ''}<span class="mots">${mots ? ' · ' + mots : ''}</span></p>
        ${f.note ? '<p class="note">' + echapper(f.note) + '</p>' : ''}
        ${f.abstract ? '<p class="resume">' + echapper(f.abstract) + '</p><button type="button" class="deplier" data-deplier>+ résumé</button>' : ''}
      </div>
    </article>`;
}

// ── État ────────────────────────────────────────────────────────────────

const selection = new Set();   // clés pliées des mots-clés actifs
let requete = '';

/** Filtrage cumulatif : une fiche doit porter *tous* les mots-clés actifs. */
function retenues() {
  const mots = pliage(requete).split(/\s+/).filter(Boolean);
  return FICHES.filter((f) => {
    const cles = new Set((f.tags ?? []).map(pliage));
    for (const t of selection) if (!cles.has(t)) return false;
    if (!mots.length) return true;
    const foin = pliage([f.titre, f.abstract, f.note, (f.auteurs ?? []).join(' '), f.revue, (f.tags ?? []).join(' ')].join(' '));
    return mots.every((m) => foin.includes(m));
  });
}

function dessiner() {
  const vues = retenues();

  $('#liste').innerHTML = vues.length
    ? vues.map(entree).join('')
    : '<p class="vide">Aucune référence ne réunit ces critères.</p>';

  // Les mots-clés proposés se réduisent à ceux encore disponibles dans la
  // sélection courante : sans quoi on propose des filtres qui ne mènent
  // qu'à une liste vide.
  const disponibles = new Map();
  for (const f of vues) {
    for (const t of f.tags ?? []) {
      const cle = pliage(t);
      if (selection.has(cle)) continue;
      disponibles.set(cle, { libelle: t, n: (disponibles.get(cle)?.n ?? 0) + 1 });
    }
  }
  const ordonnes = [...disponibles.values()].sort((a, b) => b.n - a.n || a.libelle.localeCompare(b.libelle, 'fr'));
  $('#filtres').innerHTML = ordonnes.length
    ? ordonnes
        .map((t) => `<button type="button" class="mc" data-tag="${echapper(t.libelle)}">${echapper(t.libelle)} <span aria-hidden="true">${t.n}</span></button>`)
        .join('')
    : '<span class="compte" style="margin:0">aucun autre mot-clé</span>';

  $('#actifs').innerHTML = [...selection]
    .map((cle) => {
      const source = FICHES.find((f) => (f.tags ?? []).some((t) => pliage(t) === cle));
      const libelle = (source?.tags ?? []).find((t) => pliage(t) === cle) ?? cle;
      return `<button type="button" class="actif" data-retirer="${echapper(cle)}">${echapper(libelle)}</button>`;
    })
    .join('');

  $('#compte').textContent =
    vues.length + (vues.length > 1 ? ' références' : ' référence') +
    (vues.length === FICHES.length ? '' : ' sur ' + FICHES.length);

  // L'état de filtrage vit dans l'URL : un filtre utile se met en favori et
  // se partage, et le bouton « précédent » du navigateur fonctionne.
  const params = new URLSearchParams();
  if (selection.size) params.set('tags', [...selection].join(','));
  if (requete) params.set('q', requete);
  const cible = params.toString() ? '?' + params : location.pathname;
  history.replaceState(null, '', cible);
}

document.addEventListener('click', (ev) => {
  const ajout = ev.target.closest('[data-tag]');
  if (ajout) { selection.add(pliage(ajout.dataset.tag)); dessiner(); return; }

  const retrait = ev.target.closest('[data-retirer]');
  if (retrait) { selection.delete(retrait.dataset.retirer); dessiner(); return; }

  const bascule = ev.target.closest('[data-deplier]');
  if (bascule) {
    const resume = bascule.previousElementSibling;
    const ouvert = resume.classList.toggle('ouvert');
    bascule.textContent = ouvert ? '− replier' : '+ résumé';
  }
});

$('#recherche').addEventListener('input', (ev) => { requete = ev.target.value; dessiner(); });

/**
 * Révèle le lien vers l'outil de capture, et seulement pour son propriétaire.
 *
 * Le site est public : personne n'a à voir un lien vers un outil qu'il ne
 * peut pas utiliser. L'outil étant servi depuis la même origine, ses réglages
 * sont lisibles ici, et leur simple présence suffit à reconnaître le
 * navigateur qui a été configuré.
 *
 * On ne teste que l'existence de la clé, jamais son contenu : le jeton n'a
 * pas à transiter par le code du site public.
 */
function revelerLienOutil() {
  const lien = document.getElementById('lien-outil');
  if (!lien) return;
  try {
    if (localStorage.getItem('veille.config.v1')) lien.hidden = false;
  } catch {
    // Stockage local refusé (navigation privée, réglages stricts) : le lien
    // reste masqué, ce qui est exactement le comportement voulu ailleurs que
    // sur mes propres appareils.
  }
}
revelerLienOutil();

// Reprise de l'état depuis l'URL au chargement.
const params = new URLSearchParams(location.search);
for (const tag of (params.get('tags') ?? '').split(',').filter(Boolean)) selection.add(tag);
requete = params.get('q') ?? '';
$('#recherche').value = requete;

dessiner();
