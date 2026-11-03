/**
 * The package a request form opens with, on the landing page and in the app
 * alike: 14 posts and 2 videos, the standard Framic content package.
 */
export const DEFAULT_PACKAGE_REQUEST: Readonly<{ posts: number; videos: number }> = { posts: 14, videos: 2 }

/**
 * The most a single request may ask for of each kind. The request form, the
 * server's request schema and the quantity Paddle lets a checkout go up to
 * all read these, so none of them can accept more than the others.
 */
export const ADD_ON_LIMITS: Readonly<{ posts: number; videos: number; credits: number }> = {
  posts: 1000,
  videos: 1000,
  credits: 10_000_000,
}
