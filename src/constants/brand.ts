/**
 * Product branding for the SaaS platform.
 *
 * The product is AxleOps — a multi-company fleet operations platform.
 * Individual companies (e.g. the "Johnson Arabia" demo) are customers/tenants
 * inside AxleOps, not the product name itself.
 *
 * Change these values to rebrand the whole app from one place.
 */
export const BRAND = {
  name: 'AxleOps',
  tagline: 'Fleet Operations Platform',
  shortDesc: 'Run your entire rental fleet — one platform, every company.',
  // Indigo / violet SaaS palette
  colors: {
    primary: '#6366f1',       // indigo-500
    primaryDark: '#4f46e5',   // indigo-600
    accent: '#8b5cf6',        // violet-500
    gradientFrom: '#4f46e5',
    gradientVia: '#6d28d9',
    gradientTo: '#312e81',
  },
  year: new Date().getFullYear(),
} as const;
