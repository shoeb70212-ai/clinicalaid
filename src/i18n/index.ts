import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import hi from './locales/hi.json'
import mr from './locales/mr.json'
import ta from './locales/ta.json'

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      hi: { translation: hi },
      mr: { translation: mr },
      ta: { translation: ta },
    },
    lng:           'en',
    fallbackLng:   'en',
    interpolation: { escapeValue: false },  // React handles XSS escaping — disable i18next double-escaping
  })

export default i18n
