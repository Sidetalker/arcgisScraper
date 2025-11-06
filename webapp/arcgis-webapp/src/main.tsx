import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { CacheProvider } from './context/CacheContext';
import { ListingsProvider } from './context/ListingsContext';
import { WatchlistsProvider } from './context/WatchlistsContext';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <CacheProvider>
        <ListingsProvider>
          <WatchlistsProvider>
            <App />
          </WatchlistsProvider>
        </ListingsProvider>
      </CacheProvider>
    </BrowserRouter>
  </React.StrictMode>
);
