/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppLayout } from './components/layout/AppLayout';
import Home from './pages/Home';
import History from './pages/History';
import Converter from './pages/Converter';
import ImageToolkit from './pages/ImageToolkit';
import Settings from './pages/Settings';
import Login from './pages/Login';
import Register from './pages/Register';
import CookieUpload from './pages/CookieUpload';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AppLayout />}>
          <Route index element={<Home />} />
          <Route path="converter" element={<Converter />} />
          <Route path="image-toolkit" element={<ImageToolkit />} />
          <Route path="history" element={<History />} />
          <Route path="settings" element={<Settings />} />
          <Route path="cookies" element={<CookieUpload />} />
        </Route>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Routes>
    </BrowserRouter>
  );
}
