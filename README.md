# Cap! — Backend Push Notifications

Mini serveur Express pour envoyer les notifications push quotidiennes de la PWA Cap!

## Stack

* **Node.js** + Express
* **web-push** — protocole Web Push (VAPID)
* **node-cron** — cron toutes les minutes pour déclencher les notifications
* **Fichier JSON** — stockage des subscriptions

## Déploiement sur Render (gratuit)

### 1\. Générer les clés VAPID

```bash
node -e "const wp=require('web-push'); console.log(wp.generateVAPIDKeys())"
```

Notez bien `publicKey` et `privateKey`.

### 2\. Créer le projet Render

1. Allez sur [https://render.com/](https://render.com/) → **Deploy from GitHub repo**
2. Connectez ce repo (ou uploadez les fichiers)



### 3\. Configurer les variables d'environnement

Dans Railway → votre projet → **Variables** → ajouter :

|Variable|Valeur|
|-|-|
|`VAPID\\\_PUBLIC\\\_KEY`|votre clé publique VAPID|
|`VAPID\\\_PRIVATE\\\_KEY`|votre clé privée VAPID|
|`VAPID\\\_EMAIL`|`mailto:votre@email.com`|
|`ALLOWED\\\_ORIGIN`|`https://mykado72.github.io`|

`PORT` est automatiquement défini par Railway — ne pas le renseigner.

### 4\. Déployer

Railway lance `npm start` → `node server.js` automatiquement.

L'URL publique sera du type : `https://cap-backend-xxxx.up.railway.app`

### 5\. Configurer la PWA

Dans `app.js` de la PWA, mettre à jour :

```js
const BACKEND\\\_URL = 'https://cap-backend-xxxx.up.railway.app';
```

Et dans `manifest.json`, s'assurer que `start\\\_url` pointe sur le bon chemin.

## Endpoints

|Méthode|Route|Description|
|-|-|-|
|GET|`/`|Health check|
|GET|`/vapid-public-key`|Retourne la clé publique VAPID|
|POST|`/subscribe`|Enregistre une subscription push|
|POST|`/update-time`|Met à jour l'heure de notification|
|POST|`/unsubscribe`|Supprime une subscription|
|POST|`/test-notification`|Envoie une notification de test|

## Fonctionnement du cron

Toutes les minutes, le serveur récupère l'heure courante en **Europe/Paris** (HH:MM) et envoie une notification à tous les abonnés dont `notifyAt` correspond à cette heure.

Les subscriptions expirées (codes 404/410) sont automatiquement supprimées.

## Structure des données (subscriptions.json)

```json
\\\[
  {
    "subscription": { "endpoint": "...", "keys": { "p256dh": "...", "auth": "..." } },
    "notifyAt": "20:00",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z"
  }
]
```

