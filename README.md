# D-50 Editor — éditeur, librairie et générateur de sons pour Roland D-50 / D-550

Une seule application (web + PWA installable) qui tourne **sous Windows et sous Android**
dans Chrome ou Edge, grâce à l'API **Web MIDI** (SysEx).

## Fonctions

| Onglet | Rôle |
|---|---|
| **Patch** | Key mode, split, transpositions, reverb, chorus/chase, volume, paramètres MIDI |
| **Upper / Lower** | *Common* (structure 1-7 avec schéma, P-ENV graphique, LFO 1-3, EQ, chorus) et *Partial 1 / 2* (WG, TVF, TVA, enveloppes dessinées). Les paramètres qui ne s'appliquent pas au type de partial (synthé ou PCM) sont grisés. Copie P1→P2, Upper→Lower |
| **Bibliothèque** | Banque de 64 cases (11 à 88) : import/export `.syx`, réception d'un *Bulk Dump*, écriture d'une case ou de toute la banque dans le D-50, **morphing** entre deux patches |
| **MIDI** | Moniteur des messages envoyés/reçus, *All notes off* |

- **✦ Créer** : génère un son neuf à partir d'un type (Pad, Strings, Brass, Basse, Lead, Cloche, Texture/FX) ; le curseur à côté règle la part d'aléatoire.
- **Envoi en temps réel** : chaque curseur envoie un message DT1 au D-50 (zone d'édition temporaire), on entend le changement immédiatement.
- **Annuler / Rétablir** (↶ ↷, Ctrl+Z / Ctrl+Y). Double-clic sur un contrôle = valeur par défaut.
- **Clavier virtuel** (tactile, glissando) + clavier d'ordinateur (rangée A S D F…).
- La banque et le patch en cours sont conservés dans le navigateur ; exportez en `.syx` pour une vraie sauvegarde.

## Matériel

- **Windows** : interface MIDI USB branchée sur MIDI IN/OUT du D-50.
- **Android** : interface MIDI USB + adaptateur **USB-OTG** (USB-C → USB-A). Chrome Android gère le MIDI USB nativement.

Réglages du D-50 (MIDI) : **Exclusive = ON**, **Unit #** identique au réglage « Unit # » de l'appli
(1 par défaut), et pour écrire en mémoire : **Memory Protect / MIDI Protect = OFF**.

## Lancer l'application

### Windows
Double-cliquez sur **`Lancer D-50 Editor.bat`** : un petit serveur local démarre et ouvre
`http://localhost:8050` dans le navigateur. Utilisez **Chrome ou Edge** (Firefox/Safari : pas de SysEx).
Acceptez la demande d'accès aux appareils MIDI. Ensuite, menu ⋮ → *Installer D-50 Editor* pour
en faire une application avec son icône (fonctionne aussi hors-ligne).

### Android
Le Web MIDI exige une adresse **HTTPS**. Le plus simple : héberger le dossier gratuitement
(GitHub Pages, Netlify, Cloudflare Pages…), l'ouvrir dans **Chrome Android**, puis
⋮ → *Ajouter à l'écran d'accueil / Installer l'application*.
Une fois installée, l'appli fonctionne hors-ligne.

## Récupérer les sons du D-50
- **Patch en cours** : bouton **◀ Recevoir** (requête RQ1). Si le D-50 ne répond pas, utilisez le dump ci-dessous.
- **Toute la mémoire** : sur le D-50, *DATA TRANSFER → B.Dump* : les 64 patches arrivent dans la Bibliothèque.

## Fichiers
```
index.html            interface
css/style.css         styles (thème sombre, adapté téléphone)
js/d50.js             carte des paramètres D-50, SysEx Roland (DT1/RQ1, checksum), import/export .syx, générateur, morphing
js/app.js             logique de l'interface, MIDI, clavier, bibliothèque
manifest.webmanifest  + sw.js + icons/   → application installable (PWA), hors-ligne
serveur.ps1 / Lancer D-50 Editor.bat     serveur local Windows (aucune installation)
```

## Notes techniques
- Adresses : zone temporaire `00 00 00` (Upper P1, P2, Common, Lower P1, P2, Common, Patch : 7 × 64 octets),
  mémoire interne `02 00 00` + n × 448 octets. Modèle `0x14`, envois par blocs de 64/256 octets espacés.
- Les fichiers `.syx` de banques D-50 courants (format DT1 one-way) sont reconnus ; les données au-delà des
  64 patches (données de reverb) sont conservées telles quelles à l'export.
