import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { SUPPORTED_LOCALES } from '@ce/shared';
import en from './locales/en.json';
import hi from './locales/hi.json';
import gu from './locales/gu.json';
import { prefs } from '../utils/storage.js';

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'gu', label: 'ગુજરાતી' },
];

const saved = prefs.get('lang', null);
const browser = typeof navigator !== 'undefined' ? navigator.language?.slice(0, 2) : 'en';
const initial = SUPPORTED_LOCALES.includes(saved) ? saved : SUPPORTED_LOCALES.includes(browser) ? browser : 'en';

i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, hi: { translation: hi }, gu: { translation: gu } },
  lng: initial,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  prefs.set('lang', lng);
  document.documentElement.lang = lng;
});

export default i18n;
