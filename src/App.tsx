/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { lazy, Suspense, type ComponentType } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { RequireAuth } from './components/auth/RequireAuth';
import { Skeleton } from './components/ui/skeleton';
import Home from './pages/Home';
import History from './pages/History';
import Converter from './pages/Converter';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Register from './pages/Register';
import Profile from './pages/Profile';
import CookieUpload from './pages/CookieUpload';

// Route-level code splitting for the heaviest, least-frequently-visited
// pages (the editor tools and the whole WhatsApp Campaign module) - these
// were the single largest contributors to the >1MB main bundle chunk every
// production build warned about. Home/Converter/Settings/auth pages stay
// eager since they're the common first-paint path and are comparatively
// small; splitting them would just add a loading flicker for no bundle-size
// benefit.
const ImageToolkit = lazy(() => import('./pages/ImageToolkit'));
const BackgroundEditor = lazy(() => import('./pages/BackgroundEditor'));
const PdfStudio = lazy(() => import('./pages/PdfStudio'));
const WhatsappDashboard = lazy(() => import('./pages/whatsapp/WhatsappDashboard'));
const WhatsappCampaigns = lazy(() => import('./pages/whatsapp/WhatsappCampaigns'));
const WhatsappTemplates = lazy(() => import('./pages/whatsapp/WhatsappTemplates'));
const WhatsappAccounts = lazy(() => import('./pages/whatsapp/WhatsappAccounts'));
const WhatsappContacts = lazy(() => import('./pages/whatsapp/WhatsappContacts'));
const WhatsappGroups = lazy(() => import('./pages/whatsapp/WhatsappGroups'));
const WhatsappLabels = lazy(() => import('./pages/whatsapp/WhatsappLabels'));
const WhatsappSettings = lazy(() => import('./pages/whatsapp/WhatsappSettings'));
const WhatsappAnalytics = lazy(() => import('./pages/whatsapp/WhatsappAnalytics'));

// Reuses the app's existing Skeleton loading convention (see
// RequireAuth.tsx, Profile.tsx, and every WhatsApp page's own data-fetch
// loading state) rather than a spinner, so a lazy chunk load looks like the
// same kind of "content incoming" state the app already shows everywhere
// else, not a one-off pattern.
const PageLoadingFallback = () => (
  <div className="space-y-4">
    <Skeleton className="h-10 w-48" />
    <Skeleton className="h-40 w-full" />
    <Skeleton className="h-40 w-full" />
  </div>
);

const lazyPage = (Component: ComponentType) => (
  <Suspense fallback={<PageLoadingFallback />}>
    <Component />
  </Suspense>
);

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Home />} />
          <Route path="converter" element={<Converter />} />
          <Route path="image-toolkit" element={lazyPage(ImageToolkit)} />
          <Route path="background-editor" element={lazyPage(BackgroundEditor)} />
          <Route path="pdf-studio" element={lazyPage(PdfStudio)} />
          <Route path="history" element={<History />} />
          <Route path="settings" element={<Settings />} />
          <Route path="cookies" element={<CookieUpload />} />
          <Route element={<RequireAuth />}>
            <Route path="profile" element={<Profile />} />
            <Route path="whatsapp" element={lazyPage(WhatsappDashboard)} />
            <Route path="whatsapp/campaigns" element={lazyPage(WhatsappCampaigns)} />
            <Route path="whatsapp/templates" element={lazyPage(WhatsappTemplates)} />
            <Route path="whatsapp/accounts" element={lazyPage(WhatsappAccounts)} />
            <Route path="whatsapp/contacts" element={lazyPage(WhatsappContacts)} />
            <Route path="whatsapp/groups" element={lazyPage(WhatsappGroups)} />
            <Route path="whatsapp/labels" element={lazyPage(WhatsappLabels)} />
            <Route path="whatsapp/settings" element={lazyPage(WhatsappSettings)} />
            <Route path="whatsapp/analytics" element={lazyPage(WhatsappAnalytics)} />
          </Route>
        </Route>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Routes>
    </BrowserRouter>
  );
}
