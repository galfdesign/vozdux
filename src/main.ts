import 'leaflet/dist/leaflet.css'
import './style.css'
import L from 'leaflet'
import logo from './logo.png'

type AirQualityMeasurement = {
  parameter: string
  value: number
  unit: string
}

type AirQualityData = {
  city: string | null
  country: string | null
  measurements: AirQualityMeasurement[]
  source: string
}

type PollutionLevelId = 'good' | 'moderate' | 'unhealthy' | 'very-unhealthy'

type PollutionLevel = {
  id: PollutionLevelId
  label: string
  color: string
}

type FilterAdvice = {
  dust: string
  gases?: string
}

type NormInfo = {
  limit: number
  unit: string
  label: string
}

// Упрощённые ориентировочные суточные нормы (близкие к рекомендациям ВОЗ и типовым СанПиН), единицы — µg/m³
const NORMS: Record<string, NormInfo> = {
  pm2_5: { limit: 15, unit: 'µg/m³', label: 'Рекомендуемая суточная норма PM2.5' },
  pm10: { limit: 45, unit: 'µg/m³', label: 'Рекомендуемая суточная норма PM10' },
  nitrogen_dioxide: { limit: 25, unit: 'µg/m³', label: 'Рекомендуемая суточная норма NO₂' },
  sulphur_dioxide: { limit: 40, unit: 'µg/m³', label: 'Рекомендуемая суточная норма SO₂' },
  ozone: { limit: 100, unit: 'µg/m³', label: 'Рекомендуемая 8‑часовая норма O₃' },
  carbon_monoxide: { limit: 4000, unit: 'µg/m³', label: 'Рекомендуемая 24‑часовая норма CO (≈4 мг/м³)' },
  ammonia: { limit: 200, unit: 'µg/m³', label: 'Ориентировочная норма NH₃' },
}

const appEl = document.querySelector<HTMLDivElement>('#app')

if (!appEl) {
  throw new Error('Не найден элемент #app')
}

appEl.innerHTML = `
  <div class="page">
    <header class="header">
      <div class="header-logo-block">
        <img src="${logo}" alt="Логотип" class="header-logo" />
        <div class="header-logo-caption">проектирование вентиляции</div>
      </div>
      <a
        href="https://t.me/galfdesign"
        class="header-telegram"
        target="_blank"
        rel="noreferrer"
        aria-label="Telegram GalfDesign"
      >
        <svg class="header-telegram-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="11" />
          <path
            d="M17.6 7.2 6.9 11.2c-.5.2-.5.7 0 .9l2.6.8 1 3.1c.1.4.6.5.8.2l1.4-1.5 2.5 1.9c.3.2.7 0 .8-.4l1.7-8c.1-.4-.3-.7-.7-.6Z"
          />
        </svg>
      </a>
      <div class="header-title">Качество воздуха</div>
      <div class="header-subtitle">
        Нажмите по точке на карте, чтобы получить данные о загрязнении воздуха (online).
      </div>
    </header>
    <main class="layout">
      <section class="map-panel">
        <div id="map"></div>
      </section>
      <aside class="info-panel">
        <div id="info-card" class="info-card info-card--empty">
          <div class="info-placeholder">
             Выберите точку на карте.
          </div>
    </div>
      </aside>
    </main>
  </div>
`

const map = L.map('map', {
  zoomControl: true,
})

// Центр плюс-минус по России
const russiaCenter: L.LatLngExpression = [61.524, 105.3188]

map.setView(russiaCenter, 3)

// Слой Яндекс.Карт с русскими подписями городов
L.tileLayer('https://core-renderer-tiles.maps.yandex.net/tiles?l=map&v=21.07.09-0&x={x}&y={y}&z={z}&scale=1&lang=ru_RU', {
  maxZoom: 19,
  subdomains: ['01', '02', '03', '04'],
  attribution: '© Яндекс',
}).addTo(map)

// Убираем префикс Leaflet в подписи
if (map.attributionControl) {
  map.attributionControl.setPrefix('')
}

let marker: L.CircleMarker | null = null
let pollutionCircle: L.Circle | null = null

const infoCardEl = document.getElementById('info-card') as HTMLDivElement | null

function renderLoading() {
  if (!infoCardEl) return
  infoCardEl.className = 'info-card info-card--loading'
  infoCardEl.innerHTML = `
    <div class="info-title">Загружаем данные…</div>
    <div class="info-loading-spinner"></div>
  `
}

function renderError(message: string) {
  if (!infoCardEl) return
  infoCardEl.className = 'info-card info-card--error'
  infoCardEl.innerHTML = `
    <div class="info-title">Ошибка</div>
    <div class="info-error-text">${message}</div>
  `
}

function formatParameterName(param: string): string {
  const key = param.toLowerCase()

  switch (key) {
    case 'pm2_5':
    case 'pm2.5':
      return 'PM2.5 (мелкие частицы)'
    case 'pm10':
      return 'PM10 (крупные частицы)'
    case 'nitrogen_dioxide':
    case 'no2':
      return 'Диоксид азота (NO₂)'
    case 'sulphur_dioxide':
    case 'so2':
      return 'Диоксид серы (SO₂)'
    case 'ozone':
    case 'o3':
      return 'Озон (O₃)'
    case 'carbon_monoxide':
    case 'co':
      return 'Оксид углерода (CO)'
    case 'ammonia':
    case 'nh3':
      return 'Аммиак (NH₃)'
    default:
      return param.toUpperCase()
  }
}

function getNormFor(parameter: string): NormInfo | null {
  const key = parameter.toLowerCase()
  if (key in NORMS) return NORMS[key]

  // Для параметров из OpenWeather, где вместо полных имён только сокращения
  if (key === 'no2') return NORMS.nitrogen_dioxide
  if (key === 'so2') return NORMS.sulphur_dioxide
  if (key === 'o3') return NORMS.ozone
  if (key === 'co') return NORMS.carbon_monoxide
  if (key === 'pm2.5') return NORMS.pm2_5
  if (key === 'nh3') return NORMS.ammonia

  return null
}

function splitMeasurements(measurements: AirQualityMeasurement[]) {
  const dust: AirQualityMeasurement[] = []
  const gases: AirQualityMeasurement[] = []

  for (const m of measurements) {
    const k = m.parameter.toLowerCase()
    if (k === 'pm2_5' || k === 'pm2.5' || k === 'pm10') {
      dust.push(m)
    } else {
      gases.push(m)
    }
  }

  return { dust, gases }
}

function buildFilterAdvice(measurements: AirQualityMeasurement[]): FilterAdvice {
  const { dust, gases } = splitMeasurements(measurements)

  const find = (names: string[]) =>
    measurements.find((m) => names.includes(m.parameter.toLowerCase()))

  const pm25 = find(['pm2_5', 'pm2.5'])
  const pm10 = find(['pm10'])

  const base = pm25 ?? pm10
  const value = base?.value ?? 0

  let dustText: string

  if (!base) {
    dustText = 'Рекомендуется базовая ступень фильтрации ePM10 (класс G4) для задержания крупной пыли.'
  } else if (value <= 10) {
    dustText =
      'Достаточна ступень ePM10 / ePM2.5 базового уровня (G4–F5) для стандартных бытовых и офисных помещений.'
  } else if (value <= 25) {
    dustText =
      'Рекомендуется фильтр ePM2.5 50–65% (класс F7) для уверенной очистки приточного воздуха от мелкой пыли.'
  } else if (value <= 50) {
    dustText =
      'Рекомендуется фильтр ePM2.5 65–80% (класс F8) или сочетание предварительного и тонкого фильтра.'
  } else {
    dustText =
      'Высокая запылённость: рекомендуется высокая ступень ePM1 ≥80% (F9) и при необходимости HEPA для чувствительных зон.'
  }

  // Считаем газ «проблемным», только если есть норма и текущее значение её превышает
  const hasGasOverNorm = gases.some((m) => {
    const norm = getNormFor(m.parameter)
    return norm ? m.value > norm.limit : false
  })

  const gasesText = hasGasOverNorm
    ? 'Выявлено превышение норм по газообразным загрязнителям (NO₂, SO₂, O₃, CO, NH₃) — рекомендуется добавить угольную/сорбционную ступень фильтрации.'
    : undefined

  return { dust: dustText, gases: gasesText }
}

function getPollutionLevel(measurements: AirQualityMeasurement[]): PollutionLevel | null {
  if (!measurements.length) return null

  const byName = (names: string[]) =>
    measurements.find((m) => names.includes(m.parameter.toLowerCase()))

  const pm25 = byName(['pm2_5', 'pm2.5'])
  const pm10 = byName(['pm10'])

  const base = pm25 ?? pm10
  if (!base) return null

  const value = base.value

  if (value <= 15) {
    return { id: 'good', label: 'Низкий уровень загрязнения', color: '#22c55e' }
  }
  if (value <= 35) {
    return { id: 'moderate', label: 'Умеренное загрязнение', color: '#eab308' }
  }
  if (value <= 55) {
    return { id: 'unhealthy', label: 'Повышенное загрязнение', color: '#f97316' }
  }
  return { id: 'very-unhealthy', label: 'Очень высокое загрязнение', color: '#ef4444' }
}

function renderData(
  { city, country, measurements, source }: AirQualityData,
  lat: number,
  lng: number,
  level: PollutionLevel | null,
  extremes: AirQualityMeasurement[] | null,
) {
  if (!infoCardEl) return

  if (!measurements.length) {
    infoCardEl.className = 'info-card info-card--empty'
    infoCardEl.innerHTML = `
      <div class="info-title">Нет данных</div>
      <div class="info-placeholder">
        Для выбранной точки данные не найдены. Попробуйте другой город.
      </div>
      <div class="coords">Координаты: ${lat.toFixed(3)}, ${lng.toFixed(3)}</div>
    `
    return
  }

  const placeParts = [
    city ?? undefined,
    country ?? undefined,
  ].filter(Boolean)

  const place = placeParts.join(', ') || 'Точка на карте'

  const { dust, gases } = splitMeasurements(measurements)

  const renderMetricRow = (m: AirQualityMeasurement): string => {
    const norm = getNormFor(m.parameter)
    const over = norm ? m.value > norm.limit : false

    const rowClass = over ? 'metric-row metric-row--alert' : 'metric-row'
    const badge =
      norm != null
        ? over
          ? `<div class="metric-badge">выше нормы · ${norm.limit.toFixed(0)} ${norm.unit}</div>`
          : `<div class="metric-badge metric-badge--norm">норма ~ ${norm.limit.toFixed(0)} ${norm.unit}</div>`
        : `<div class="metric-badge metric-badge--spacer"></div>`

    return `
      <div class="${rowClass}">
        <div class="metric-name">${formatParameterName(m.parameter)}</div>
        <div class="metric-value">
          ${m.value.toFixed(1)} <span class="metric-unit">${m.unit}</span>
        </div>
        ${badge}
      </div>
    `
  }

  const dustHtml = dust.map(renderMetricRow).join('')
  const gasesHtml = gases.map(renderMetricRow).join('')

  // Для рекомендаций по фильтрации используем худший сценарий:
  // если есть экстремальные значения за 30 дней — опираемся на них, иначе на текущий замер.
  const filterAdviceSource = extremes && extremes.length ? extremes : measurements
  const filterAdvice = buildFilterAdvice(filterAdviceSource)

  const extremesHtml =
    extremes && extremes.length
      ? (() => {
          const rows = extremes
            .map((m) => {
              const norm = getNormFor(m.parameter)
              const over = norm ? m.value > norm.limit : false

              const rowClass = over ? 'extremes-row extremes-row--alert' : 'extremes-row'
              const badge =
                norm != null
                  ? over
                    ? `<div class="extremes-badge">выше нормы · ${norm.limit.toFixed(0)} ${norm.unit}</div>`
                    : `<div class="extremes-badge extremes-badge--norm">ниже нормы · ${norm.limit.toFixed(0)} ${norm.unit}</div>`
                  : `<div class="extremes-badge extremes-badge--spacer"></div>`

              return `
        <div class="${rowClass}">
          <div class="extremes-name">${formatParameterName(m.parameter)}</div>
          <div class="extremes-value">
            ${m.value.toFixed(1)} <span class="extremes-unit">${m.unit}</span>
          </div>
          ${badge}
        </div>
      `
            })
            .join('')

          return `
    <div class="extremes">
      <div class="extremes-title">Максимальные значения за последние 30 дней</div>
      ${rows}
    </div>
  `
        })()
      : ''

  infoCardEl.className = 'info-card'

  const levelSection = level
    ? `
    <div class="level-row">
      <span class="level-dot" style="background:${level.color}"></span>
      <span class="level-text">${level.label}</span>
    </div>
  `
    : ''

  infoCardEl.innerHTML = `
    <div class="info-title">${place}</div>
    <div class="coords">Координаты: ${lat.toFixed(3)}, ${lng.toFixed(3)}</div>
    ${levelSection}
    <div class="filter-advice">
      <div class="filter-advice-title">Рекомендация по фильтрации воздуха (по максимумам за 30 дней)</div>
      <div class="filter-advice-text">${filterAdvice.dust}</div>
      ${
        filterAdvice.gases
          ? `<div class="filter-advice-text filter-advice-text--secondary">${filterAdvice.gases}</div>`
          : ''
      }
    </div>
    <div class="metrics">
      <div class="metrics-caption">Текущие значения качества воздуха (режим реального времени, ближайший час)</div>
      <div class="metrics-group">
        <div class="metrics-group-title">Частицы (пыль)</div>
        ${dustHtml || '<div class="metric-row metric-row--muted">Нет данных по твёрдым частицам</div>'}
      </div>
      <div class="metrics-group">
        <div class="metrics-group-title">Газы</div>
        ${gasesHtml || '<div class="metric-row metric-row--muted">Нет данных по газообразным загрязнителям</div>'}
      </div>
    </div>
    ${extremesHtml}
    <div class="info-footnote">
      Данные предоставлены сервисом ${source}.
    </div>
  `
}

async function fetchAirQualityExtremes(lat: number, lng: number): Promise<AirQualityMeasurement[]> {
  // Open-Meteo: берём максимум за последние 30 дней (исторические данные), без расхода ключа OpenWeather
  const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality')
  url.searchParams.set('latitude', lat.toString())
  url.searchParams.set('longitude', lng.toString())
  url.searchParams.set(
    'hourly',
    [
      'pm2_5',
      'pm10',
      'nitrogen_dioxide',
      'sulphur_dioxide',
      'ozone',
      'carbon_monoxide',
      'ammonia',
    ].join(','),
  )
  url.searchParams.set('timezone', 'auto')
  url.searchParams.set('past_days', '30')
  url.searchParams.set('forecast_days', '0')

  const response = await fetch(url.toString())
  if (!response.ok) {
    throw new Error(`Open-Meteo extremes error: ${response.status}`)
  }

  const data = await response.json()
  if (!data.hourly || !data.hourly.time || !data.hourly.time.length) {
    return []
  }

  const extremes: AirQualityMeasurement[] = []

  for (const key of Object.keys(data.hourly)) {
    if (key === 'time') continue

    const series = data.hourly[key]
    if (!Array.isArray(series) || !series.length) continue

    let max = -Infinity
    for (const v of series) {
      if (v == null) continue
      const num = Number(v)
      if (Number.isNaN(num)) continue
      if (num > max) max = num
    }

    if (!Number.isFinite(max)) continue

    const unit =
      (data.hourly_units && data.hourly_units[key]) ||
      'µg/m³'

    extremes.push({
      parameter: key,
      value: max,
      unit,
    })
  }

  return extremes
}

async function fetchFromOpenMeteo(lat: number, lng: number): Promise<AirQualityData> {
  // Open-Meteo Air Quality API — не требует ключа и поддерживает CORS из браузера
  const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality')
  url.searchParams.set('latitude', lat.toString())
  url.searchParams.set('longitude', lng.toString())
  // Просим максимум доступных параметров — какие реально есть, те и используем
  url.searchParams.set(
    'hourly',
    [
      'pm2_5',
      'pm10',
      'nitrogen_dioxide',
      'sulphur_dioxide',
      'ozone',
      'carbon_monoxide',
      'ammonia',
    ].join(','),
  )
  url.searchParams.set('timezone', 'auto')

  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new Error(`Сервис вернул ошибку: ${response.status}`)
  }

  const data = await response.json()

  if (data.error || data.reason) {
    throw new Error(String(data.error || data.reason))
  }

  if (!data.hourly || !data.hourly.time || !data.hourly.time.length) {
    return {
      city: null,
      country: null,
      measurements: [],
      source: 'Open-Meteo Air Quality API',
    }
  }

  const measurements: AirQualityMeasurement[] = []
  const total = data.hourly.time.length

  // Ищем самый свежий час, для которого есть хоть какие‑то числовые значения
  let indexWithAnyValue = -1
  outer: for (let i = total - 1; i >= 0; i--) {
    for (const key of Object.keys(data.hourly)) {
      if (key === 'time') continue
      const series = data.hourly[key]
      if (!Array.isArray(series) || series.length <= i) continue
      const v = series[i]
      if (v == null) continue
      const num = Number(v)
      if (Number.isNaN(num)) continue
      indexWithAnyValue = i
      break outer
    }
  }

  if (indexWithAnyValue === -1) {
    return {
      city: null,
      country: null,
      measurements: [],
      source: 'Open-Meteo Air Quality API',
    }
  }

  // Собираем показатели для найденного часа по всем параметрам
  for (const key of Object.keys(data.hourly)) {
    if (key === 'time') continue

    const series = data.hourly[key]
    if (!Array.isArray(series) || series.length <= indexWithAnyValue) continue

    const raw = series[indexWithAnyValue]
    if (raw == null) continue

    const value = Number(raw)
    if (Number.isNaN(value)) continue

    const unit =
      (data.hourly_units && data.hourly_units[key]) ||
      'µg/m³'

    measurements.push({
      parameter: key,
      value,
      unit,
    })
  }

  return {
    city: null,
    country: null,
    measurements,
    source: 'Open-Meteo Air Quality API',
  }
}

async function fetchFromOpenWeather(lat: number, lng: number): Promise<AirQualityData | null> {
  const apiKey = import.meta.env.VITE_OPENWEATHER_API_KEY
  if (!apiKey) return null

  const url = new URL('https://api.openweathermap.org/data/2.5/air_pollution')
  url.searchParams.set('lat', lat.toString())
  url.searchParams.set('lon', lng.toString())
  url.searchParams.set('appid', apiKey)

  const response = await fetch(url.toString())

  if (!response.ok) {
    console.warn('OpenWeather API error', response.status)
    return null
  }

  const data = await response.json()

  if (!data.list || !data.list.length) {
    return {
      city: null,
      country: null,
      measurements: [],
      source: 'OpenWeather Air Pollution API',
    }
  }

  const first = data.list[0]
  const components = first.components || {}

  const mapping: { key: string; label: string }[] = [
    { key: 'pm2_5', label: 'PM2.5' },
    { key: 'pm10', label: 'PM10' },
    { key: 'no2', label: 'NO2' },
    { key: 'so2', label: 'SO2' },
    { key: 'o3', label: 'O3' },
    { key: 'co', label: 'CO' },
  ]

  const measurements: AirQualityMeasurement[] = []

  for (const { key, label } of mapping) {
    const raw = components[key]
    if (raw == null) continue

    const value = Number(raw)
    if (Number.isNaN(value)) continue

    measurements.push({
      parameter: label,
      value,
      unit: 'µg/m³',
    })
  }

  return {
    city: null,
    country: null,
    measurements,
    source: 'OpenWeather Air Pollution API',
  }
}

async function fetchAirQuality(lat: number, lng: number): Promise<AirQualityData> {
  // Сначала пробуем OpenWeather (если есть ключ), затем Open-Meteo как открытый fallback
  const fromOpenWeather = await fetchFromOpenWeather(lat, lng)
  if (fromOpenWeather) return fromOpenWeather

  return await fetchFromOpenMeteo(lat, lng)
}

map.on('click', async (e: L.LeafletMouseEvent) => {
  const { lat, lng } = e.latlng

  renderLoading()

  try {
    const [data, extremes] = await Promise.all([
      fetchAirQuality(lat, lng),
      fetchAirQualityExtremes(lat, lng).catch(() => [] as AirQualityMeasurement[]),
    ])
    const level = getPollutionLevel(data.measurements)

    if (marker) {
      marker.setLatLng([lat, lng])
    } else {
      marker = L.circleMarker([lat, lng], {
        radius: 7,
        color: '#60a5fa',
        fillColor: '#3b82f6',
        fillOpacity: 1,
        weight: 2,
      }).addTo(map)
    }

    if (level) {
      marker.setStyle({
        color: level.color,
        fillColor: level.color,
      })
    } else {
      marker.setStyle({
        color: '#6b7280',
        fillColor: '#6b7280',
      })
    }

    if (pollutionCircle) {
      map.removeLayer(pollutionCircle)
      pollutionCircle = null
    }

    if (level) {
      pollutionCircle = L.circle([lat, lng], {
        radius: 5000, // 5 км
        color: level.color,
        fillColor: level.color,
        fillOpacity: 0.35,
        weight: 2,
      }).addTo(map)
    }

    renderData(data, lat, lng, level, extremes)
  } catch (err) {
    console.error(err)
    renderError('Не удалось получить данные. Попробуйте кликнуть ещё раз или позже.')
  }
})
