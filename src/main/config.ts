import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, unlinkSync } from 'fs'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import type { AppConfig, BrandLogosData, BrandLogoEntry } from '../shared/types'

const CONFIG_FILENAME = 'config.json'

export function getConfigPath(): string {
  const userData = app.getPath('userData')
  return join(userData, CONFIG_FILENAME)
}

const BRAND_LOGO_FILENAME = 'brand-logo.dat'
const BRAND_LOGOS_FILENAME = 'brand-logos.json'

/** Path to legacy single logo file (used only for migration). */
export function getBrandLogoPath(): string {
  return join(app.getPath('userData'), BRAND_LOGO_FILENAME)
}

function getBrandLogosPath(): string {
  return join(app.getPath('userData'), BRAND_LOGOS_FILENAME)
}

/** Migrate from legacy brand-logo.dat to brand-logos.json if needed. */
function migrateBrandLogosIfNeeded(): void {
  const newPath = getBrandLogosPath()
  if (existsSync(newPath)) return
  const oldPath = getBrandLogoPath()
  if (!existsSync(oldPath)) return
  try {
    const dataUrl = readFileSync(oldPath, 'utf-8')
    if (!dataUrl || !dataUrl.startsWith('data:')) return
    const id = randomUUID()
    const data: BrandLogosData = { logos: [{ id, dataUrl }] }
    writeFileSync(newPath, JSON.stringify(data, null, 2), 'utf-8')
    unlinkSync(oldPath)
    const config = loadConfig()
    config.activeBrandLogoId = id
    saveConfig(config)
  } catch {
    // leave old file in place on error
  }
}

function loadBrandLogosData(): BrandLogosData {
  migrateBrandLogosIfNeeded()
  const path = getBrandLogosPath()
  if (!existsSync(path)) return { logos: [] }
  try {
    const raw = readFileSync(path, 'utf-8')
    const data = JSON.parse(raw) as BrandLogosData
    if (!Array.isArray(data.logos)) return { logos: [] }
    return { logos: data.logos.filter((e) => e?.id && e?.dataUrl) }
  } catch {
    return { logos: [] }
  }
}

function saveBrandLogosData(data: BrandLogosData): void {
  writeFileSync(getBrandLogosPath(), JSON.stringify(data, null, 2), 'utf-8')
}

/** Returns the data URL of the currently active brand logo, or null. */
export function getActiveBrandLogo(): string | null {
  const config = loadConfig()
  const id = config.activeBrandLogoId ?? null
  if (!id) return null
  const { logos } = loadBrandLogosData()
  const entry = logos.find((e) => e.id === id)
  return entry?.dataUrl ?? null
}

export function listBrandLogos(): { logos: BrandLogoEntry[]; activeId: string | null } {
  const config = loadConfig()
  const { logos } = loadBrandLogosData()
  return { logos, activeId: config.activeBrandLogoId ?? null }
}

export function addBrandLogo(dataUrl: string, name?: string): string {
  const data = loadBrandLogosData()
  const id = randomUUID()
  data.logos.push({ id, name, dataUrl })
  saveBrandLogosData(data)
  const config = loadConfig()
  if (data.logos.length === 1) {
    config.activeBrandLogoId = id
    saveConfig(config)
  }
  return id
}

export function setActiveBrandLogo(id: string | null): void {
  const config = loadConfig()
  config.activeBrandLogoId = id ?? undefined
  saveConfig(config)
}

export function updateBrandLogo(id: string, updates: { name?: string }): void {
  const data = loadBrandLogosData()
  const entry = data.logos.find((e) => e.id === id)
  if (!entry) return
  if (updates.name !== undefined) entry.name = updates.name.trim() || undefined
  saveBrandLogosData(data)
}

export function removeBrandLogo(id: string): void {
  const data = loadBrandLogosData()
  const config = loadConfig()
  const wasActive = config.activeBrandLogoId === id
  data.logos = data.logos.filter((e) => e.id !== id)
  saveBrandLogosData(data)
  if (wasActive) {
    config.activeBrandLogoId = data.logos.length > 0 ? data.logos[0].id : undefined
    saveConfig(config)
  }
}

const defaultConfig: AppConfig = {
  theme: 'light',
  brandColors: {},
  stepBackgroundColor: '#f7f7f7',
  stepNumberIconBgColor: '#ffffff',
  stepNumberIconTextColor: '#000000',
  rootFolderDisplayName: 'My SOPs'
}

export function loadConfig(): AppConfig {
  const path = getConfigPath()
  if (!existsSync(path)) return { ...defaultConfig }
  try {
    const raw = readFileSync(path, 'utf-8')
    const data = JSON.parse(raw) as Partial<AppConfig>
    return {
      theme: data.theme ?? defaultConfig.theme,
      brandColors: data.brandColors ?? defaultConfig.brandColors,
      storagePath: data.storagePath,
      activeBrandLogoId: data.activeBrandLogoId ?? undefined,
      stepBackgroundColor: data.stepBackgroundColor ?? defaultConfig.stepBackgroundColor,
      stepNumberIconBgColor: data.stepNumberIconBgColor ?? defaultConfig.stepNumberIconBgColor,
      stepNumberIconTextColor: data.stepNumberIconTextColor ?? defaultConfig.stepNumberIconTextColor,
      rootFolderDisplayName: data.rootFolderDisplayName ?? defaultConfig.rootFolderDisplayName
    }
  } catch {
    return { ...defaultConfig }
  }
}

export function saveConfig(config: AppConfig): void {
  const path = getConfigPath()
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8')
}
