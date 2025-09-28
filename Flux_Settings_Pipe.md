# ComfyUI — ⚙️ Flux/Sdxl Settings Pipe & 📤 Settings Pipe Unpack

**Version**: 1.0.0\
**Auteur**: [Light-x02](https://github.com/Light-x02)

> Ces deux nœuds sont pensés pour simplifier les workflows **Flux** et **SDXL** : un unique nœud pour régler la résolution et les paramètres de sampling, et un nœud pour dépaqueter les champs depuis le **pipe**.

---

## ⚙️ Flux/Sdxl Settings Pipe

### Description

Nœud central qui **prépare les paramètres** pour **Flux** *ou* **SDXL**. Il propose deux listes de résolutions adaptées (Flux vs SDXL) et un **switch** (`mode_resolution`) pour passer de l’un à l’autre. Il calcule et renvoie un **pipe** (objet structuré) qui regroupe tout le nécessaire pour sampler proprement, ainsi que des sorties individuelles (latent, width/height, sampler, sigmas, etc.).

### Fonctions principales

- **Mode Flux/SDXL switchable** (`mode_resolution`) avec **résolutions adaptées** à chaque famille de modèles.
- **Résolutions prédéfinies** + **overrides** (`width_override`, `height_override`) et **flip d’orientation** (échanger W/H) pour aller plus vite.
- **Sampler & Scheduler** : sélectionne le sampler et le scheduler officiels de ComfyUI.
- **Steps & Denoise** : contrôle précis du nombre d’itérations et de la force de débruitage.
- **Guidance & CFG** : gère la guidance (écrit dans la conditioning) et expose un **CFG** dédié.
- **Seed & Bruit** : génère un **générateur de bruit** réutilisable (custom noise) + expose le **seed**.
- **Sortie Pipe** : renvoie un **FLUX\_PIPE** complet, idéal pour garder un workflow **propre et modulaire**.

### Exemple d’usage

1. Place **⚙️ Flux/Sdxl Settings Pipe** et choisis **Flux** ou **SDXL** via `mode_resolution`.

2. Choisis `sampler_name`, `scheduler`, `steps`, `denoise`. Règle `guidance` ou `cfg`.

3. Chaîne la sortie **`pipe`** vers **📤 Settings Pipe Unpack** (si tu veux des sorties individuelles proprement).

---

## 📤 Settings Pipe Unpack

### Description

Dépaquette un **FLUX\_PIPE** pour récupérer **toutes les sorties** utiles **sans encombrer le workflow**. La première sortie PIPE permet de **prolonger** la chaîne à partir du même objet si besoin (bonne pratique pour garder un graphe propre et modulaire).

### Pourquoi l’utiliser ?

- **Centraliser** : un seul câble du nœud central vers l’unpack → moins de fils partout.
- **Prolongeable** : garde `pipe` en première sortie pour enchaîner d’autres nœuds compatibles.
- **Lisibilité** : workflows plus **propres** et **maintenables**.

---

## Presets — Gestion et bonnes pratiques

Ces nœuds incluent un **système de presets** (bouton **Manage presets** côté UI) permettant de **sauvegarder/charger** l’état du nœud **⚙️ Flux/Sdxl Settings Pipe**.

### Ce qui est sauvegardé

- Les **valeurs des widgets** principaux du nœud (résolution, mode Flux/SDXL, steps, denoise, sampler, scheduler, guidance, cfg, etc.).
- Les elements purement **UI** (headers colorés, bouton de gestion) **ne sont pas** enregistrés.

### Opérations disponibles

- **Apply to node** : applique le preset sélectionné au nœud courant.
- **Save (overwrite)** : écrase le preset sélectionné avec les valeurs actuelles du nœud.
- **Save As…** : crée un **nouveau preset**.
- **Rename…** : renomme un preset.
- **Delete** : supprime le preset.
- **Export / Import** : échange de presets via fichiers JSON..

### Où sont stockés les presets ?

- Un **fichier JSON par preset** dans un sous-dossier `presets/` de l’extension

---

---

## Compatibilité

- Compatibles **Flux** et **SDXL** (listes de résolutions pensées pour chaque famille de modèles).
- Le **pipe** est conçu pour rester **stable et prolongeable**, afin d’éviter l’enchevêtrement de câbles.

---

## Support

Si ces nœuds te font gagner du temps, tu peux soutenir le projet :\
**Ko‑fi** → [https://ko-fi.com/light\_x02](https://ko-fi.com/light_x02)

---

## Licence

Sauf mention contraire dans le repo, ces fichiers sont publiés sous licence MIT.

