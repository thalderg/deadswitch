import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { WalletProvider } from './near/wallet';
import { Layout } from './components/Layout';
import { Landing } from './pages/Landing';
import { PlanPage } from './pages/Plan';
import { SetupPage } from './pages/Setup';
import { HeirPage } from './pages/Heir';
import { SummaryPage } from './pages/Summary';
import { NotFound } from './pages/NotFound';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WalletProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/plan" element={<PlanPage />} />
            <Route path="/plan/summary" element={<SummaryPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/heir" element={<HeirPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </WalletProvider>
  </StrictMode>,
);
