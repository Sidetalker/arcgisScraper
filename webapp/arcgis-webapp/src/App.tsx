import reactLogo from '@/assets/react.svg';
import './App.css';

function App(): JSX.Element {
  return (
    <div className="app">
      <header className="app__header">
        <img src={reactLogo} className="app__logo" alt="React logo" />
        <h1>ArcGIS Web App</h1>
        <p>
          This project is powered by Vite, React, and TypeScript. Start building your ArcGIS
          integrations by editing <code>src/App.tsx</code>.
        </p>
      </header>
    </div>
  );
}

export default App;
