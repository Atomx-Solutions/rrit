import { describe, expect, it } from 'vitest'
import { savedFileName } from '../../app/utils/save-file'

describe('savedFileName', () => {
  it('adds the extension of the downloaded type', () => {
    expect(savedFileName('Autumn menu', 'image/png')).toBe('Autumn menu.png')
    expect(savedFileName('Reel', 'video/mp4')).toBe('Reel.mp4')
  })

  it('keeps a name that already has the right extension', () => {
    expect(savedFileName('framic-business.json', 'application/json')).toBe('framic-business.json')
    expect(savedFileName('photo.jpeg', 'image/jpeg')).toBe('photo.jpeg')
  })

  it('replaces a known extension that does not match the content', () => {
    expect(savedFileName('photo.jpg', 'image/webp; charset=binary')).toBe('photo.webp')
  })

  it('keeps dots that are part of the name', () => {
    expect(savedFileName('Menu v1.2', 'image/png')).toBe('Menu v1.2.png')
  })

  it('removes characters a file name cannot hold', () => {
    expect(savedFileName('Offer 50/50: today?', 'image/jpeg')).toBe('Offer 50-50- today-.jpg')
  })

  it('leaves the name as it is for an unknown type', () => {
    expect(savedFileName('notes', '')).toBe('notes')
  })
})
