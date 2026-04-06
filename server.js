require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const webpush    = require('web-push');
const cron       = require('node-cron');
const fs         = require('fs');
const path       = require('path');

// ─── Config ──────────────────────────────────────────────────────────────────
const PORT          = process.env.PORT || 3000;
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_EMAIL   = process.env.VAPID_EMAIL || 'mailto:admin@cap-app.fr';
const SUBS_FILE     = path.join(__dirname, 'data', 'subscriptions.json');

if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
  console.error('❌  Variables VAPID manquantes dans .env');
  process.exit(1);
}

webpush.setVapidDetails(VAPID_EMAIL, VAPID_PUBLIC, VAPID_PRIVATE);

// ─── Persistence JSON ─────────────────────────────────────────────────────────
function loadSubs() {
  try {
    fs.mkdirSync(path.dirname(SUBS_FILE), { recursive: true });
    if (!fs.existsSync(SUBS_FILE)) return [];
    return JSON.parse(fs.readFileSync(SUBS_FILE, 'utf8'));
  } catch { return []; }
}

function saveSubs(subs) {
  fs.mkdirSync(path.dirname(SUBS_FILE), { recursive: true });
  fs.writeFileSync(SUBS_FILE, JSON.stringify(subs, null, 2));
}

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();

app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST', 'DELETE']
}));
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, subs: loadSubs().length }));

// Clé publique VAPID (la PWA en a besoin pour s'abonner)
app.get('/vapid-public-key', (_req, res) => {
  res.json({ key: VAPID_PUBLIC });
});

// S'abonner
app.post('/subscribe', (req, res) => {
  const { subscription, notifyAt, notifyAt2 } = req.body;
  if (!subscription?.endpoint || !notifyAt || !/^\d{2}:\d{2}$/.test(notifyAt)) {
    return res.status(400).json({ error: 'Données invalides' });
  }
  if (notifyAt2 && !/^\d{2}:\d{2}$/.test(notifyAt2)) {
    return res.status(400).json({ error: 'Format notifyAt2 invalide' });
  }

  let subs = loadSubs();
  const existing = subs.findIndex(s => s.subscription.endpoint === subscription.endpoint);

  if (existing >= 0) {
    subs[existing].notifyAt  = notifyAt;
    subs[existing].notifyAt2 = notifyAt2 || '';
    subs[existing].updatedAt = new Date().toISOString();
  } else {
    subs.push({
      subscription,
      notifyAt,
      notifyAt2: notifyAt2 || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  saveSubs(subs);
  console.log(`✅ Abonné enregistré — notifyAt: ${notifyAt}${notifyAt2 ? ' · ' + notifyAt2 : ''}`);
  res.json({ ok: true });
});

// Mettre à jour l'heure seulement
app.post('/update-time', (req, res) => {
  const { endpoint, notifyAt, notifyAt2 } = req.body;
  if (!endpoint || !notifyAt || !/^\d{2}:\d{2}$/.test(notifyAt)) {
    return res.status(400).json({ error: 'Données invalides' });
  }
  if (notifyAt2 && !/^\d{2}:\d{2}$/.test(notifyAt2)) {
    return res.status(400).json({ error: 'Format notifyAt2 invalide' });
  }

  let subs = loadSubs();
  const idx = subs.findIndex(s => s.subscription.endpoint === endpoint);
  if (idx < 0) return res.status(404).json({ error: 'Abonné introuvable' });

  subs[idx].notifyAt  = notifyAt;
  subs[idx].notifyAt2 = notifyAt2 || '';
  subs[idx].updatedAt = new Date().toISOString();
  saveSubs(subs);
  console.log(`🕐 Heure mise à jour — ${endpoint.slice(-20)}… → ${notifyAt}${notifyAt2 ? ' · ' + notifyAt2 : ''}`);
  res.json({ ok: true });
});

// Se désabonner
app.post('/unsubscribe', (req, res) => {
  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Endpoint manquant' });

  let subs = loadSubs();
  subs = subs.filter(s => s.subscription.endpoint !== endpoint);
  saveSubs(subs);
  console.log(`🗑️  Désabonné: ${endpoint.slice(-20)}…`);
  res.json({ ok: true });
});

// Notification de test immédiate
app.post('/test-push', async (req, res) => {
  const { endpoint } = req.body;
  const subs = loadSubs();
  const entry = subs.find(s => s.subscription.endpoint === endpoint);
  if (!entry) return res.status(404).json({ error: 'Abonné introuvable' });

  try {
    await sendNotification(entry.subscription, {
      title: 'Cap! 🎯',
      body: 'Fais le point sur tes objectifs 🎯',
      tag: 'cap-test'
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur test push:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Envoi notification ───────────────────────────────────────────────────────
async function sendNotification(subscription, payload) {
  return webpush.sendNotification(subscription, JSON.stringify(payload));
}

// ─── Cron — toutes les minutes ────────────────────────────────────────────────
cron.schedule('* * * * *', async () => {
  const nowStr = new Date().toLocaleTimeString('en-GB', {
    timeZone: 'Europe/Paris',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  let subs = loadSubs();
  // Cibler les abonnés dont notifyAt OU notifyAt2 correspond à l'heure courante
  const targets = subs.filter(s => s.notifyAt === nowStr || (s.notifyAt2 && s.notifyAt2 === nowStr));
  if (targets.length === 0) return;

  console.log(`🔔 ${nowStr} — Envoi à ${targets.length} abonné(s)`);

  const expired = [];
  for (const entry of targets) {
    try {
      await sendNotification(entry.subscription, {
        title: 'Cap! 🎯',
        body: 'Fais le point sur tes objectifs 🎯',
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: 'cap-daily',
        renotify: true,
      });
      console.log(`  ✅ ${entry.subscription.endpoint.slice(-20)}…`);
    } catch (err) {
      console.error(`  ❌ ${err.statusCode} — ${entry.subscription.endpoint.slice(-20)}…`);
      if (err.statusCode === 410) expired.push(entry.subscription.endpoint);
    }
  }

  if (expired.length > 0) {
    saveSubs(subs.filter(s => !expired.includes(s.subscription.endpoint)));
    console.log(`🧹 ${expired.length} abonnement(s) expirés supprimés`);
  }
}, { timezone: 'Europe/Paris' });

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Cap! backend — port ${PORT}`);
  console.log(`📋 ${loadSubs().length} abonné(s) en base`);
});
