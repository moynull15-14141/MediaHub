/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import { RequireAuth } from './components/auth/RequireAuth';
import Home from './pages/Home';
import History from './pages/History';
import Converter from './pages/Converter';
import ImageToolkit from './pages/ImageToolkit';
import BackgroundEditor from './pages/BackgroundEditor';
import PdfStudio from './pages/PdfStudio';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Register from './pages/Register';
import Profile from './pages/Profile';
import CookieUpload from './pages/CookieUpload';
import WhatsappDashboard from './pages/whatsapp/WhatsappDashboard';
import WhatsappCampaigns from './pages/whatsapp/WhatsappCampaigns';
import WhatsappTemplates from './pages/whatsapp/WhatsappTemplates';
import WhatsappAccounts from './pages/whatsapp/WhatsappAccounts';
import WhatsappContacts from './pages/whatsapp/WhatsappContacts';
import WhatsappGroups from './pages/whatsapp/WhatsappGroups';
import WhatsappLabels from './pages/whatsapp/WhatsappLabels';
import WhatsappSettings from './pages/whatsapp/WhatsappSettings';
import WhatsappAnalytics from './pages/whatsapp/WhatsappAnalytics';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Home />} />
          <Route path="converter" element={<Converter />} />
          <Route path="image-toolkit" element={<ImageToolkit />} />
          <Route path="background-editor" element={<BackgroundEditor />} />
          <Route path="pdf-studio" element={<PdfStudio />} />
          <Route path="history" element={<History />} />
          <Route path="settings" element={<Settings />} />
          <Route path="cookies" element={<CookieUpload />} />
          <Route element={<RequireAuth />}>
            <Route path="profile" element={<Profile />} />
            <Route path="whatsapp" element={<WhatsappDashboard />} />
            <Route path="whatsapp/campaigns" element={<WhatsappCampaigns />} />
            <Route path="whatsapp/templates" element={<WhatsappTemplates />} />
            <Route path="whatsapp/accounts" element={<WhatsappAccounts />} />
            <Route path="whatsapp/contacts" element={<WhatsappContacts />} />
            <Route path="whatsapp/groups" element={<WhatsappGroups />} />
            <Route path="whatsapp/labels" element={<WhatsappLabels />} />
            <Route path="whatsapp/settings" element={<WhatsappSettings />} />
            <Route path="whatsapp/analytics" element={<WhatsappAnalytics />} />
          </Route>
        </Route>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Routes>
    </BrowserRouter>
  );
}
