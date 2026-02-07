import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

import ru from './locales/ru.json';
import en from './locales/en.json';

const resources = {
    ru: { translation: ru },
    en: { translation: en }
};

i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
        resources,
        fallbackLng: 'ru',
        interpolation: {
            escapeValue: false // React уже экранирует
        },
        detection: {
            order: ['localStorage', 'navigator'],
            caches: ['localStorage']
        }
    });

export default i18n;
