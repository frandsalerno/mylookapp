import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BrainCircuit,
  Calendar,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Cloud,
  CloudSun,
  Heart,
  Home,
  Key,
  MapPin,
  Moon,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shirt,
  Sparkles,
  Sun,
  SunMedium,
  Thermometer,
  X,
} from 'lucide-react';
import { createClient } from '@supabase/supabase-js';
import { CATEGORY_ORDER, PREDEFINED_LOOKS, STORAGE_KEYS, SUPABASE_BUCKET, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './lib/constants';
import {
  dataUrlToBlob,
  dedupeById,
  fetchWithTimeout,
  fileToDataUrl,
  guessExtensionFromDataUrl,
  inferSeason,
  inferTimeOfDay,
  newId,
  randomPick,
  resizeImageDataUrl,
  weatherCodeToLabel,
} from './lib/helpers';
import { persist, readJson } from './lib/storage';

function pageMotion() {
  return {
    initial: { opacity: 0, x: 10 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -10 },
    transition: { duration: 0.15 },
  };
}

export function App() {
  const [tab, setTab] = useState('home');
  const [theme, setTheme] = useState(readJson(STORAGE_KEYS.theme, 'light'));

  const [settings, setSettings] = useState(readJson(STORAGE_KEYS.settings, { apiKey: '', model: 'gpt-4.1-mini' }));
  const [wardrobe, setWardrobe] = useState(readJson(STORAGE_KEYS.wardrobe, []));
  const [history, setHistory] = useState(readJson(STORAGE_KEYS.history, []));
  const [syncStatus, setSyncStatus] = useState('Supabase: connecting...');

  const [selectedLookType, setSelectedLookType] = useState(PREDEFINED_LOOKS[0].label);
  const [customLook, setCustomLook] = useState('');
  const [timeOverride, setTimeOverride] = useState('day');
  const [context, setContext] = useState({
    city: 'Unknown',
    season: inferSeason(new Date().getMonth() + 1),
    weatherLabel: 'unknown',
    temperatureC: null,
    timeOfDay: inferTimeOfDay(new Date().getHours()),
  });

  const [suggestion, setSuggestion] = useState(null);
  const [pendingSuggestionFavorite, setPendingSuggestionFavorite] = useState(false);
  const [suggestionFavStatus, setSuggestionFavStatus] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);

  const [addItemOpen, setAddItemOpen] = useState(false);
  const [itemName, setItemName] = useState('');
  const [itemCategory, setItemCategory] = useState('tops');
  const [itemStyle, setItemStyle] = useState('');
  const [itemSeason, setItemSeason] = useState('all');
  const [itemFile, setItemFile] = useState(null);
  const [pendingItemImageData, setPendingItemImageData] = useState('');
  const [aiItemStatus, setAiItemStatus] = useState('');
  const [aiSuggestion, setAiSuggestion] = useState(null);

  const [wardrobeSearch, setWardrobeSearch] = useState('');
  const [wardrobeCategoryFilter, setWardrobeCategoryFilter] = useState('all');
  const [wardrobeFavoritesOnly, setWardrobeFavoritesOnly] = useState(false);

  const [historyLookFilter, setHistoryLookFilter] = useState('');
  const [historyFavoritesOnly, setHistoryFavoritesOnly] = useState(false);

  const [savedState, setSavedState] = useState(false);

  const supabase = useMemo(() => createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY), []);

  useEffect(() => {
    document.body.classList.toggle('dark', theme === 'dark');
    persist(STORAGE_KEYS.theme, theme);
  }, [theme]);

  useEffect(() => persist(STORAGE_KEYS.settings, settings), [settings]);
  useEffect(() => persist(STORAGE_KEYS.wardrobe, wardrobe), [wardrobe]);
  useEffect(() => persist(STORAGE_KEYS.history, history), [history]);

  useEffect(() => {
    refreshContext();
    syncFromSupabase();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function logError(code, error, meta = {}) {
    const message = error?.message || String(error || 'unknown');
    console.error('[MyLook]', code, message, meta);
    try {
      await supabase.from('app_logs').insert({
        code,
        message,
        meta,
        user_agent: navigator.userAgent,
        created_at_client: new Date().toISOString(),
      });
    } catch {
      // best effort
    }
  }

  async function syncFromSupabase() {
    setSyncStatus('Supabase: syncing wardrobe and history...');
    try {
      const wardrobeRes = await supabase.from('wardrobe_items').select('*').order('created_at', { ascending: false });
      if (wardrobeRes.error) throw wardrobeRes.error;
      const historyRes = await supabase.from('history_entries').select('*').order('accepted_at', { ascending: true });
      if (historyRes.error) throw historyRes.error;

      const remoteWardrobe = (wardrobeRes.data || []).map((row) => ({
        id: row.id,
        name: row.name,
        category: row.category,
        season: row.season,
        styleTags: row.style_tags || [],
        imageUrl: row.image_url,
        imagePath: row.image_path,
        isFavorite: !!row.is_favorite,
        createdAt: row.created_at,
      }));
      const remoteHistory = (historyRes.data || []).map((row) => ({
        id: row.id,
        acceptedAt: row.accepted_at,
        lookType: row.look_type,
        outfit: row.outfit || [],
        contextSummary: row.context_summary,
        isFavorite: !!row.is_favorite,
      }));

      if (!remoteWardrobe.length && wardrobe.length) {
        await migrateLocalWardrobe();
      } else {
        setWardrobe(remoteWardrobe);
      }

      if (!remoteHistory.length && history.length) {
        await migrateLocalHistory();
      } else {
        setHistory(remoteHistory);
      }
      setSyncStatus('Supabase: synced.');
    } catch (e) {
      setSyncStatus('Supabase: sync failed. Working locally.');
      logError('supabase_sync_failed', e);
    }
  }

  async function migrateLocalWardrobe() {
    for (const item of wardrobe) {
      try {
        const imageData = item.imageData || item.imageUrl;
        if (!imageData) continue;
        const uploaded = await uploadImageDataToSupabase(imageData);
        await supabase.from('wardrobe_items').insert({
          id: item.id || newId(),
          name: item.name || 'Untitled item',
          category: item.category || 'tops',
          season: item.season || 'all',
          style_tags: item.styleTags || [],
          is_favorite: !!item.isFavorite,
          image_url: uploaded.imageUrl,
          image_path: uploaded.imagePath,
          created_at: item.createdAt || new Date().toISOString(),
        });
      } catch (e) {
        logError('migrate_wardrobe_item_failed', e, { itemId: item.id });
      }
    }
  }

  async function migrateLocalHistory() {
    try {
      await supabase.from('history_entries').insert(
        history.map((entry) => ({
          id: entry.id || newId(),
          accepted_at: entry.acceptedAt || new Date().toISOString(),
          look_type: entry.lookType || 'Look',
          outfit: entry.outfit || [],
          context_summary: entry.contextSummary || '',
          is_favorite: !!entry.isFavorite,
        }))
      );
    } catch (e) {
      logError('migrate_history_failed', e);
    }
  }

  async function uploadImageDataToSupabase(imageData) {
    const blob = dataUrlToBlob(imageData);
    const ext = guessExtensionFromDataUrl(imageData);
    const path = 'items/' + Date.now() + '_' + newId() + '.' + ext;
    const upload = await supabase.storage.from(SUPABASE_BUCKET).upload(path, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: false,
    });
    if (upload.error) throw upload.error;
    const pub = supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
    return { imagePath: path, imageUrl: pub.data.publicUrl };
  }

  async function refreshContext() {
    const resolveWeatherContext = async (lat, lon, fallbackCity = 'Unknown') => {
      const weatherPayload = await fetchWithTimeout(
        `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&timezone=auto`,
        10000
      ).then((r) => r.json());

      let city = fallbackCity;
      try {
        const geocode = await fetchWithTimeout(
          `https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}&language=en&format=json`,
          8000
        ).then((r) => r.json());
        city = geocode?.results?.[0]?.name || fallbackCity;
      } catch {
        // keep fallback city
      }

      setContext({
        city,
        season: inferSeason(new Date().getMonth() + 1),
        weatherLabel: weatherCodeToLabel(weatherPayload?.current?.weather_code),
        temperatureC: typeof weatherPayload?.current?.temperature_2m === 'number' ? weatherPayload.current.temperature_2m : null,
        timeOfDay: inferTimeOfDay(new Date().getHours()),
      });
    };

    try {
      const gps = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) reject(new Error('no geolocation'));
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, timeout: 8000 });
      });

      const lat = gps.coords.latitude;
      const lon = gps.coords.longitude;
      await resolveWeatherContext(lat, lon, 'Unknown');
    } catch (e) {
      try {
        const ip = await fetchWithTimeout('https://ipapi.co/json/', 7000).then((r) => r.json());
        if (typeof ip?.latitude === 'number' && typeof ip?.longitude === 'number') {
          await resolveWeatherContext(ip.latitude, ip.longitude, ip.city || 'Unknown');
        } else {
          setContext((prev) => ({ ...prev, city: ip.city || 'Unknown' }));
        }
      } catch (e2) {
        logError('weather_context_failed', e2);
      }
    }
  }

  async function getSelectedItemImageData() {
    if (pendingItemImageData) return pendingItemImageData;
    if (!itemFile) throw new Error('No image selected');
    const data = await fileToDataUrl(itemFile);
    setPendingItemImageData(data);
    return data;
  }

  async function analyzeItemWithAI() {
    if (!itemFile) {
      setAiItemStatus('Pick a photo first.');
      return;
    }
    if (!settings.apiKey) {
      setAiItemStatus('Add OpenAI API key first.');
      return;
    }

    setAiItemStatus('Analyzing photo...');
    try {
      const imageData = await getSelectedItemImageData();
      const resized = await resizeImageDataUrl(imageData, 1200, 0.82);
      const models = [settings.model || 'gpt-4.1-mini', 'gpt-4.1'];
      let parsed = null;
      let error = null;

      for (const model of models) {
        try {
          const response = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model,
              input: [
                {
                  role: 'user',
                  content: [
                    {
                      type: 'input_text',
                      text:
                        'Analyze this clothing image and return only JSON with shape {"name":"...","category":"tops|bottoms|outerwear|dresses|shoes|accessories","styleTags":["..."],"season":"all|spring|summer|autumn|winter","reason":"..."}',
                    },
                    { type: 'input_image', image_url: resized },
                  ],
                },
              ],
              max_output_tokens: 300,
            }),
          });
          if (!response.ok) throw new Error('OpenAI analyze failed ' + response.status);
          const payload = await response.json();
          const text = payload.output_text || payload.output?.[0]?.content?.find((c) => c.type === 'output_text')?.text || '';
          const jsonText = normalizeJsonText(text);
          parsed = JSON.parse(jsonText);
          break;
        } catch (e) {
          error = e;
        }
      }
      if (!parsed) throw error || new Error('No analysis output');

      const suggestion = {
        name: parsed.name || 'Untitled item',
        category: CATEGORY_ORDER.includes(String(parsed.category || '').toLowerCase()) ? String(parsed.category).toLowerCase() : 'tops',
        styleTags: Array.isArray(parsed.styleTags) ? parsed.styleTags.map(String).slice(0, 8) : [],
        season: ['all', 'spring', 'summer', 'autumn', 'winter'].includes(parsed.season) ? parsed.season : 'all',
        reason: parsed.reason || 'Detected from image.',
      };
      setItemName((v) => v || suggestion.name);
      setItemCategory(suggestion.category);
      setItemSeason(suggestion.season);
      setItemStyle(suggestion.styleTags.join(', '));
      setAiSuggestion(suggestion);
      setAiItemStatus('AI suggestion ready. Review and save.');
    } catch (e) {
      setAiItemStatus('AI analysis failed: ' + (e.message || 'unknown error'));
      logError('ai_analyze_failed', e);
    }
  }

  async function addWardrobeItem(e) {
    e.preventDefault();
    if (!itemFile) return;
    try {
      const imageData = await getSelectedItemImageData();
      const uploaded = await uploadImageDataToSupabase(imageData);
      const item = {
        id: newId(),
        name: itemName.trim() || 'Untitled item',
        category: itemCategory,
        styleTags: itemStyle.split(',').map((t) => t.trim()).filter(Boolean),
        season: itemSeason,
        imageUrl: uploaded.imageUrl,
        imagePath: uploaded.imagePath,
        isFavorite: false,
        createdAt: new Date().toISOString(),
      };

      const result = await supabase
        .from('wardrobe_items')
        .insert({
          id: item.id,
          name: item.name,
          category: item.category,
          season: item.season,
          style_tags: item.styleTags,
          is_favorite: false,
          image_url: item.imageUrl,
          image_path: item.imagePath,
          created_at: item.createdAt,
        })
        .select('*')
        .single();

      if (result.error) throw result.error;
      setWardrobe((prev) => [
        {
          id: result.data.id,
          name: result.data.name,
          category: result.data.category,
          season: result.data.season,
          styleTags: result.data.style_tags || [],
          imageUrl: result.data.image_url,
          imagePath: result.data.image_path,
          isFavorite: !!result.data.is_favorite,
          createdAt: result.data.created_at,
        },
        ...prev,
      ]);

      setItemFile(null);
      setPendingItemImageData('');
      setItemName('');
      setItemCategory('tops');
      setItemStyle('');
      setItemSeason('all');
      setAiSuggestion(null);
      setAiItemStatus('Saved.');
    } catch (e2) {
      logError('wardrobe_insert_failed', e2);
      setAiItemStatus('Save failed: ' + e2.message);
    }
  }

  async function generateLook() {
    if (!wardrobe.length) return;
    setIsGenerating(true);
    const lookType = customLook.trim() || selectedLookType;
    const ctx = { ...context, timeOfDay: timeOverride || context.timeOfDay };

    try {
      const ai = await generateWithAI(lookType, ctx);
      setSuggestion(ai || fallbackSuggestion(lookType, ctx));
    } catch (e) {
      logError('generate_look_failed', e);
      setSuggestion(fallbackSuggestion(lookType, ctx));
    } finally {
      setIsGenerating(false);
      setPendingSuggestionFavorite(false);
      setSuggestionFavStatus('');
    }
  }

  async function generateWithAI(lookType, ctx) {
    if (!settings.apiKey) return null;
    const promptWardrobe = wardrobe.map((w) => ({
      id: w.id,
      name: w.name,
      category: w.category,
      season: w.season,
      styleTags: w.styleTags,
    }));

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${settings.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: settings.model || 'gpt-4.1-mini',
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text:
                  'Choose one outfit from the wardrobe and return only JSON {"selectedItemIds":["..."],"reason":"..."}. Include shoes if available, use season/weather/time context. context=' +
                  JSON.stringify({ lookType, ctx }) +
                  ' wardrobe=' +
                  JSON.stringify(promptWardrobe),
              },
            ],
          },
        ],
        tools: [{ type: 'web_search_preview' }],
      }),
    });
    if (!response.ok) throw new Error('OpenAI look failed ' + response.status);
    const payload = await response.json();
    const text = payload.output_text || payload.output?.[0]?.content?.find((c) => c.type === 'output_text')?.text || '';
    const parsed = JSON.parse(normalizeJsonText(text));
    const outfit = (parsed.selectedItemIds || [])
      .map((id) => wardrobe.find((w) => w.id === id))
      .filter(Boolean);
    if (!outfit.length) throw new Error('AI no outfit');
    return {
      lookType,
      source: 'openai',
      rationale: parsed.reason || 'AI-generated style suggestion.',
      outfit: dedupeById(outfit),
      context: ctx,
    };
  }

  function fallbackSuggestion(lookType, ctx) {
    const seasonal = wardrobe.filter((item) => item.season === 'all' || item.season === ctx.season);
    const pools = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, seasonal.filter((s) => s.category === c)]));
    const outfit = [];
    const useDress = pools.dresses?.length && Math.random() > 0.6;
    if (useDress) outfit.push(randomPick(pools.dresses));
    else {
      if (pools.tops.length) outfit.push(randomPick(pools.tops));
      if (pools.bottoms.length) outfit.push(randomPick(pools.bottoms));
    }
    if (pools.outerwear.length && (ctx.temperatureC == null || ctx.temperatureC < 16)) outfit.push(randomPick(pools.outerwear));
    if (pools.shoes.length) outfit.push(randomPick(pools.shoes));
    if (pools.accessories.length) outfit.push(randomPick(pools.accessories));
    return {
      lookType,
      source: 'fallback',
      rationale: `Generated for ${lookType}, ${ctx.season}, ${ctx.weatherLabel}, ${ctx.timeOfDay}.`,
      outfit: dedupeById(outfit.filter(Boolean)),
      context: ctx,
    };
  }

  async function acceptLook() {
    if (!suggestion?.outfit?.length) return;
    const entry = {
      id: newId(),
      acceptedAt: new Date().toISOString(),
      lookType: suggestion.lookType,
      contextSummary: `${suggestion.context.city}, ${suggestion.context.weatherLabel}, ${
        suggestion.context.temperatureC ?? '?'
      }C, ${suggestion.context.timeOfDay}`,
      isFavorite: pendingSuggestionFavorite,
      outfit: suggestion.outfit.map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category,
        imageUrl: i.imageUrl,
      })),
    };

    try {
      const res = await supabase
        .from('history_entries')
        .insert({
          id: entry.id,
          accepted_at: entry.acceptedAt,
          look_type: entry.lookType,
          outfit: entry.outfit,
          context_summary: entry.contextSummary,
          is_favorite: entry.isFavorite,
        })
        .select('*')
        .single();
      if (res.error) throw res.error;
      setHistory((prev) => [
        ...prev,
        {
          id: res.data.id,
          acceptedAt: res.data.accepted_at,
          lookType: res.data.look_type,
          contextSummary: res.data.context_summary,
          isFavorite: !!res.data.is_favorite,
          outfit: res.data.outfit || [],
        },
      ]);
      setSuggestion(null);
    } catch (e) {
      logError('history_insert_failed', e);
    }
  }

  async function toggleWardrobeFavorite(item) {
    const next = !item.isFavorite;
    setWardrobe((prev) => prev.map((w) => (w.id === item.id ? { ...w, isFavorite: next } : w)));
    const res = await supabase.from('wardrobe_items').update({ is_favorite: next }).eq('id', item.id);
    if (res.error) logError('wardrobe_favorite_failed', res.error, { itemId: item.id });
  }

  async function toggleHistoryFavorite(entry) {
    const next = !entry.isFavorite;
    setHistory((prev) => prev.map((h) => (h.id === entry.id ? { ...h, isFavorite: next } : h)));
    const res = await supabase.from('history_entries').update({ is_favorite: next }).eq('id', entry.id);
    if (res.error) logError('history_favorite_failed', res.error, { historyId: entry.id });
  }

  async function deleteWardrobeItem(item) {
    setWardrobe((prev) => prev.filter((w) => w.id !== item.id));
    try {
      if (item.imagePath) await supabase.storage.from(SUPABASE_BUCKET).remove([item.imagePath]);
      await supabase.from('wardrobe_items').delete().eq('id', item.id);
    } catch (e) {
      logError('wardrobe_delete_failed', e);
    }
  }

  function normalizeJsonText(text) {
    if (!text) return '{}';
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) return trimmed;
    const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i) || trimmed.match(/```\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();
    const a = trimmed.indexOf('{');
    const b = trimmed.lastIndexOf('}');
    if (a >= 0 && b > a) return trimmed.slice(a, b + 1);
    return '{}';
  }

  const filteredWardrobe = wardrobe.filter((w) => {
    if (wardrobeCategoryFilter !== 'all' && w.category !== wardrobeCategoryFilter) return false;
    if (wardrobeFavoritesOnly && !w.isFavorite) return false;
    if (!wardrobeSearch.trim()) return true;
    const hay = `${w.name} ${w.category} ${w.season} ${(w.styleTags || []).join(' ')}`.toLowerCase();
    return hay.includes(wardrobeSearch.trim().toLowerCase());
  });

  const groupedWardrobe = CATEGORY_ORDER.map((category) => ({
    category,
    items: filteredWardrobe.filter((w) => w.category === category),
  })).filter((g) => g.items.length);

  const filteredHistory = history
    .filter((h) => {
      if (historyFavoritesOnly && !h.isFavorite) return false;
      if (!historyLookFilter.trim()) return true;
      return h.lookType.toLowerCase().includes(historyLookFilter.trim().toLowerCase());
    })
    .slice()
    .reverse();

  const navItems = [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'wardrobe', label: 'Wardrobe', icon: Shirt },
    { id: 'history', label: 'History', icon: Clock3 },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  return (
    <>
      <main className="app-shell">
        <button className="dark-toggle press-scale" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
          {theme === 'dark' ? <Sun /> : <Moon />}
        </button>

        <AnimatePresence mode="wait">
          {tab === 'home' && (
            <motion.section key="home" className="tab-panel active" {...pageMotion()}>
              <header className="page-header">
                <div>
                  <h1>MyLook</h1>
                  <p>What's your vibe today?</p>
                </div>
                <Sparkles className="header-icon" />
              </header>

              <motion.section className="card section-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <p className="section-label">Choose your style</p>
                <div className="style-grid">
                  {PREDEFINED_LOOKS.map((look) => {
                    const selected = selectedLookType === look.label && !customLook.trim();
                    return (
                      <button
                        key={look.label}
                        className={`style-chip press-scale ${selected ? 'selected' : ''}`}
                        onClick={() => {
                          setSelectedLookType(look.label);
                          setCustomLook('');
                        }}
                      >
                        <span className="emoji">{look.emoji}</span>
                        <span className="label">{look.label}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="custom-style-row">
                  <input value={customLook} onChange={(e) => setCustomLook(e.target.value)} placeholder="Or describe your own style..." />
                  <button className="outline-btn press-scale" disabled={!customLook.trim()} onClick={() => setSelectedLookType(customLook.trim())}>
                    Use
                  </button>
                </div>
              </motion.section>

              <motion.section className="card section-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
                <div className="section-label">Time</div>
                <div className="segmented">
                  <button className={`segment-btn ${timeOverride === 'day' ? 'active' : ''}`} onClick={() => setTimeOverride('day')}>
                    <Sun />
                    <span>Day</span>
                  </button>
                  <button className={`segment-btn ${timeOverride === 'night' ? 'active' : ''}`} onClick={() => setTimeOverride('night')}>
                    <Moon />
                    <span>Night</span>
                  </button>
                </div>
              </motion.section>

              {!suggestion && (
                <button className="primary generate-btn press-scale glow-primary" onClick={generateLook} disabled={isGenerating}>
                  <Sparkles />
                  <span>{isGenerating ? 'Generating...' : 'Generate Outfit'}</span>
                </button>
              )}

              <motion.section className="card weather-card" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
                <h2>Context</h2>
                <div className="context-grid">
                  <div className="context-item">
                    <div className="context-icon"><MapPin /></div>
                    <div><div className="k">City</div><div className="v">{context.city}</div></div>
                  </div>
                  <div className="context-item">
                    <div className="context-icon"><CloudSun /></div>
                    <div><div className="k">Weather</div><div className="v">{context.weatherLabel}</div></div>
                  </div>
                  <div className="context-item">
                    <div className="context-icon"><Thermometer /></div>
                    <div><div className="k">Temp</div><div className="v">{context.temperatureC == null ? '?' : `${context.temperatureC}C`}</div></div>
                  </div>
                  <div className="context-item">
                    <div className="context-icon"><SunMedium /></div>
                    <div><div className="k">Season</div><div className="v">{context.season}</div></div>
                  </div>
                </div>
              </motion.section>

              {suggestion && (
                <motion.section className="card suggestion-card" initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
                  <div className="suggestion-head">
                    <div>
                      <h2>Today's Look</h2>
                      <p className="muted">{suggestion.lookType} · {timeOverride}</p>
                    </div>
                    <span className="ai-badge animate-shimmer"><Sparkles size={12} />AI Pick</span>
                  </div>

                  <div className="suggestion-block">
                    <div className="suggestion-topline">Source: {suggestion.source}</div>
                    <div className="outfit-grid">
                      {suggestion.outfit.map((item, idx) => (
                        <motion.div key={item.id} className="outfit-item press-scale" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: idx * 0.04 }}>
                          <img src={item.imageUrl} alt={item.name} />
                          <div className="caption">{item.name}</div>
                        </motion.div>
                      ))}
                    </div>
                    <div className="suggestion-why">Why: {suggestion.rationale}</div>
                  </div>

                  <div className="actions">
                    <button className="outline-btn press-scale" onClick={generateLook}><RefreshCw size={14} />Regenerate</button>
                    <button className="primary press-scale glow-primary" onClick={acceptLook}><Check size={14} />Accept</button>
                    <button
                      className={`ghost-btn press-scale ${pendingSuggestionFavorite ? 'active' : ''}`}
                      onClick={() => {
                        const next = !pendingSuggestionFavorite;
                        setPendingSuggestionFavorite(next);
                        setSuggestionFavStatus(next ? 'This suggestion will be saved as favorite when accepted.' : '');
                      }}
                    >
                      <Heart size={16} fill={pendingSuggestionFavorite ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <p className="micro-muted">{suggestionFavStatus}</p>
                </motion.section>
              )}
            </motion.section>
          )}

          {tab === 'wardrobe' && (
            <motion.section key="wardrobe" className="tab-panel active" {...pageMotion()}>
              <header className="page-header compact">
                <div>
                  <h1>Wardrobe</h1>
                  <p>{wardrobe.length} items</p>
                </div>
                <button className="primary small-btn press-scale" onClick={() => setAddItemOpen((v) => !v)}>
                  {addItemOpen ? <X size={16} /> : <Plus size={16} />}
                  <span>{addItemOpen ? 'Close' : 'Add Item'}</span>
                </button>
              </header>

              <AnimatePresence>
                {addItemOpen && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="card section-card">
                    <form className="add-item-form" onSubmit={addWardrobeItem}>
                      <div className="add-item-head">
                        <label className="photo-picker press-scale">
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => {
                              setItemFile(e.target.files?.[0] || null);
                              setPendingItemImageData('');
                              setAiSuggestion(null);
                              setAiItemStatus('');
                            }}
                            required
                          />
                          <Camera />
                          <span>Add Photo</span>
                        </label>

                        <div className="form-fields">
                          <label>Name</label>
                          <input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Blue Oxford Shirt" />
                          <label>Category</label>
                          <select value={itemCategory} onChange={(e) => setItemCategory(e.target.value)}>
                            {CATEGORY_ORDER.map((cat) => (
                              <option key={cat} value={cat}>{cat}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <label>Style tags</label>
                      <input value={itemStyle} onChange={(e) => setItemStyle(e.target.value)} placeholder="smart casual, minimal" />
                      <label>Best season</label>
                      <select value={itemSeason} onChange={(e) => setItemSeason(e.target.value)}>
                        <option value="all">all</option>
                        <option value="spring">spring</option>
                        <option value="summer">summer</option>
                        <option value="autumn">autumn</option>
                        <option value="winter">winter</option>
                      </select>

                      <button type="button" className="outline-btn press-scale" onClick={analyzeItemWithAI}>
                        <Sparkles size={16} />Analyze Photo with AI
                      </button>
                      <button type="submit" className="primary press-scale glow-primary">Save To Wardrobe</button>
                      <p className="micro-muted">{aiItemStatus}</p>
                      {aiSuggestion && (
                        <div className="suggestion-block">
                          Name: {aiSuggestion.name}\nCategory: {aiSuggestion.category}\nSeason: {aiSuggestion.season}\nTags: {aiSuggestion.styleTags.join(', ')}
                        </div>
                      )}
                    </form>
                  </motion.div>
                )}
              </AnimatePresence>

              <section className="card section-card history-filter-card">
                <div className="search-wrap"><Search /><input value={wardrobeSearch} onChange={(e) => setWardrobeSearch(e.target.value)} placeholder="Search clothes..." /></div>
                <div className="filter-row">
                  <select value={wardrobeCategoryFilter} onChange={(e) => setWardrobeCategoryFilter(e.target.value)}>
                    <option value="all">All categories</option>
                    {CATEGORY_ORDER.map((cat) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                  <label className="favorite-filter-pill">
                    <input type="checkbox" checked={wardrobeFavoritesOnly} onChange={(e) => setWardrobeFavoritesOnly(e.target.checked)} />
                    <Heart size={12} />
                    <span>Favorites</span>
                  </label>
                </div>
              </section>

              <div className="wardrobe-grid">
                {groupedWardrobe.length === 0 && <div className="card section-card">No wardrobe items match current filters.</div>}
                {groupedWardrobe.map((group, groupIdx) => (
                  <details className="group" key={group.category} open>
                    <summary>
                      {group.category} ({group.items.length}) {false ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </summary>
                    <div className="group-items">
                      {group.items.map((item, idx) => (
                        <motion.article
                          key={item.id}
                          className="wardrobe-item press-scale"
                          initial={{ opacity: 0, scale: 0.95 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: idx * 0.03 + groupIdx * 0.02 }}
                        >
                          <img src={item.imageUrl} alt={item.name} />
                          <div className="meta">
                            <h4>{item.name}</h4>
                            <p className="details">{item.category} | {item.season} | {(item.styleTags || []).join(', ') || 'no tags'}</p>
                            <div className="item-actions">
                              <button className={`fav-btn ${item.isFavorite ? 'active' : ''}`} onClick={() => toggleWardrobeFavorite(item)}>
                                <Heart size={12} fill={item.isFavorite ? 'currentColor' : 'none'} />
                                <span>{item.isFavorite ? 'Unfavorite' : 'Favorite'}</span>
                              </button>
                              <button className="danger" onClick={() => deleteWardrobeItem(item)}>Delete</button>
                            </div>
                          </div>
                        </motion.article>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </motion.section>
          )}

          {tab === 'history' && (
            <motion.section key="history" className="tab-panel active" {...pageMotion()}>
              <header className="page-header compact">
                <div>
                  <h1>History</h1>
                  <p>{history.length} accepted looks</p>
                </div>
              </header>

              <section className="card section-card">
                <input value={historyLookFilter} onChange={(e) => setHistoryLookFilter(e.target.value)} placeholder="Filter look type..." />
                <label className="favorite-filter-pill">
                  <input type="checkbox" checked={historyFavoritesOnly} onChange={(e) => setHistoryFavoritesOnly(e.target.checked)} />
                  <Heart size={12} />
                  <span>Favorite looks</span>
                </label>
              </section>

              <div className="history-list">
                {filteredHistory.length === 0 && (
                  <div className="card section-card" style={{ textAlign: 'center', padding: '40px 16px' }}>
                    <div style={{ width: 64, height: 64, borderRadius: 16, margin: '0 auto 12px', background: 'hsl(var(--muted))', display: 'grid', placeItems: 'center' }}>
                      <Clock3 size={28} color="hsl(var(--muted-foreground))" />
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'hsl(var(--muted-foreground))' }}>No looks found</div>
                    <div style={{ fontSize: 12, color: 'hsl(var(--muted-foreground))', marginTop: 6 }}>Accept outfit suggestions to build your history.</div>
                  </div>
                )}
                {filteredHistory.map((entry, idx) => (
                  <motion.article key={entry.id} className="history-item roomy" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}>
                    <div className="history-head">
                      <div className="history-meta">
                        <strong>{entry.lookType}</strong>
                        <div className="small"><Clock3 size={12} style={{ verticalAlign: '-2px' }} /> {new Date(entry.acceptedAt).toLocaleString()}</div>
                      </div>
                      <button className={`ghost-btn ${entry.isFavorite ? 'active' : ''}`} onClick={() => toggleHistoryFavorite(entry)}>
                        <Heart size={16} fill={entry.isFavorite ? 'currentColor' : 'none'} />
                      </button>
                    </div>

                    <div className="outfit-grid">
                      {entry.outfit.slice(0, 4).map((o, j) => (
                        <motion.div className="outfit-item" key={o.id || j} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: j * 0.04 }}>
                          <img src={o.imageUrl || wardrobe.find((w) => w.id === o.id)?.imageUrl || ''} alt={o.name} />
                          <div className="caption">{o.name}</div>
                        </motion.div>
                      ))}
                      {entry.outfit.length > 4 && (
                        <div className="outfit-item" style={{ display: 'grid', placeItems: 'center', background: 'hsl(var(--muted))' }}>
                          +{entry.outfit.length - 4}
                        </div>
                      )}
                    </div>
                    <div className="history-context">{entry.contextSummary}</div>
                  </motion.article>
                ))}
              </div>
            </motion.section>
          )}

          {tab === 'settings' && (
            <motion.section key="settings" className="tab-panel active" {...pageMotion()}>
              <header className="page-header compact">
                <div>
                  <h1>Settings</h1>
                  <p>Configuration and sync</p>
                </div>
              </header>

              <section className="card section-card settings-card">
                <div className="settings-head">
                  <div className="settings-icon"><BrainCircuit /></div>
                  <div>
                    <h2>AI Configuration</h2>
                    <p className="micro-muted">Set your model and API key</p>
                  </div>
                </div>

                <label>API key</label>
                <div className="search-wrap"><Key /><input type="password" value={settings.apiKey} onChange={(e) => setSettings((s) => ({ ...s, apiKey: e.target.value }))} placeholder="sk-..." /></div>
                <label>Model</label>
                <select value={settings.model} onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}>
                  <option value="gpt-4o">GPT-4o</option>
                  <option value="gpt-4o-mini">GPT-4o Mini</option>
                  <option value="gpt-4.1-mini">GPT-4.1 Mini</option>
                  <option value="gpt-4-turbo">GPT-4 Turbo</option>
                </select>

                <AnimatePresence mode="wait">
                  <motion.button
                    key={savedState ? 'saved' : 'save'}
                    className="primary press-scale glow-primary"
                    onClick={() => {
                      setSavedState(true);
                      setTimeout(() => setSavedState(false), 2000);
                    }}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                  >
                    {savedState ? <CheckCircle2 size={16} /> : <Key size={16} />}
                    <span>{savedState ? 'Saved!' : 'Save API Settings'}</span>
                  </motion.button>
                </AnimatePresence>
              </section>

              <section className="card section-card sync-card">
                <div className="settings-head">
                  <div className="settings-icon sage"><Cloud /></div>
                  <div>
                    <h2>Cloud Sync</h2>
                    <p className="micro-muted">Supabase connection and stats</p>
                  </div>
                  <span className="connected-badge">
                    <span className="dot-wrap"><span /><span /></span>
                    Connected
                  </span>
                </div>
                <p className="micro-muted">{syncStatus}</p>
                <div className="stats-panel">
                  <div><span>Wardrobe items</span><strong>{wardrobe.length}</strong></div>
                  <div><span>History entries</span><strong>{history.length}</strong></div>
                </div>
                <button className="outline-btn press-scale" onClick={syncFromSupabase}><Cloud size={16} />Sync now</button>
              </section>

              <footer className="app-footer">
                <p>MyLook v1.0.0</p>
                <p>Built for daily outfit decisions</p>
              </footer>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <nav className="bottom-nav" aria-label="Main navigation">
        {navItems.map((item, idx) => {
          const Icon = item.icon;
          const isActive = tab === item.id;
          return (
            <button key={item.id} className={`tab-btn press-scale ${isActive ? 'active' : ''}`} onClick={() => setTab(item.id)}>
              <Icon />
              <span>{item.label}</span>
            </button>
          );
        })}
        <motion.div
          layoutId="activeTab"
          className="active-tab-indicator"
          animate={{ x: ['home', 'wardrobe', 'history', 'settings'].indexOf(tab) * 88 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        />
      </nav>
    </>
  );
}
