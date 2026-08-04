import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { Search, Bell, Activity, FileText, Settings, Database, BrainCircuit, BarChart3, Inbox, TrendingUp, Gauge } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import BatchExplorer from './pages/BatchExplorer';
import ProcessMonitoring from './pages/ProcessMonitoring';
import GoldenBatch from './pages/GoldenBatch';
import AiCopilot from './pages/AiCopilot';
import ReviewDesk from './pages/ReviewDesk';
import KpiDeviationPrediction from './pages/KpiDeviationPrediction';
import SettingsPage from './pages/Settings';
import { FilterProvider, useFilter, PLANTS, PRODUCTS } from './context/FilterContext';

export const PERSONA_CONFIGS: Record<string, { landingPage: string; visiblePages: string[] }> = {
  'Plant Manager': {
    landingPage: '/dashboard',
    visiblePages: ['/dashboard', '/batch-explorer', '/golden-batch', '/kpi-deviation-prediction', '/review-desk', '/ai-copilot', '/settings']
  },
  'Plant Operator': {
    landingPage: '/process-monitoring',
    visiblePages: ['/process-monitoring', '/batch-explorer', '/review-desk', '/ai-copilot', '/settings']
  },
  'Quality Engineer': {
    landingPage: '/batch-explorer',
    visiblePages: ['/batch-explorer', '/review-desk', '/ai-copilot', '/settings']
  }
};

function Sidebar() {
  const location = useLocation();
  const { selectedPersona } = useFilter();
  const isActive = (path: string) => location.pathname === path || (path === '/dashboard' && location.pathname === '/');

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: <BarChart3 size={20} /> },
    { name: 'Batch Explorer', path: '/batch-explorer', icon: <Database size={20} /> },
    { name: 'Process Monitoring', path: '/process-monitoring', icon: <TrendingUp size={20} /> },
    { name: 'Golden Batch', path: '/golden-batch', icon: <FileText size={20} /> },
    { name: 'KPI Prediction & Deviation', path: '/kpi-deviation-prediction', icon: <Gauge size={20} /> },
    { name: 'AI Review Desk', path: '/review-desk', icon: <Inbox size={20} /> },
    { name: 'AI Copilot', path: '/ai-copilot', icon: <BrainCircuit size={20} /> },
  ];

  const allowedPages = PERSONA_CONFIGS[selectedPersona]?.visiblePages || [];
  const filteredNavItems = navItems.filter(item => allowedPages.includes(item.path));

  const showSettings = allowedPages.includes('/settings');

  return (
    <nav className="w-64 bg-white border-r border-gray-200 flex flex-col shrink-0">
      <div className="h-16 flex items-center px-6 border-b border-gray-200">
        <Activity className="text-blue-600 mr-3" size={24} />
        <h2 className="text-lg font-bold text-gray-900 tracking-tight">PharmaTwin</h2>
      </div>
      <ul className="flex-1 py-4 space-y-1">
        {filteredNavItems.map((item) => (
          <li key={item.path}>
            <Link
              to={item.path}
              className={`flex items-center gap-3 px-6 py-2.5 text-sm font-medium transition-colors ${isActive(item.path)
                  ? 'text-blue-600 bg-blue-50 border-r-4 border-blue-600'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50 border-r-4 border-transparent'
                }`}
            >
              {item.icon}
              {item.name}
            </Link>
          </li>
        ))}
      </ul>
      {showSettings && (
        <div className="p-4 border-t border-gray-200">
          <Link to="/settings" className={`flex items-center gap-3 px-2 py-2 text-sm font-medium transition-colors ${location.pathname === '/settings' ? 'text-blue-600 font-bold' : 'text-gray-600 hover:text-gray-900'}`}>
            <Settings size={20} /> Settings
          </Link>
        </div>
      )}
    </nav>
  );
}

function Header() {
  const location = useLocation();
  const {
    selectedPlant, setSelectedPlant,
    selectedProduct, setSelectedProduct,
    selectedBatch, setSelectedBatch,
    availableBatches,
    selectedPersona, setSelectedPersona
  } = useFilter();

  const [dropdownOpen, setDropdownOpen] = useState(false);

  const isDashboard = location.pathname === '/' || location.pathname === '/dashboard';


  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0 select-none">
      <div className="flex gap-4">
        <select
          value={selectedPlant}
          onChange={(e) => setSelectedPlant(e.target.value)}
          className="bg-gray-50 border border-gray-200 text-sm text-gray-700 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        >
          {PLANTS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select
          value={selectedProduct}
          onChange={(e) => setSelectedProduct(e.target.value)}
          className="bg-gray-50 border border-gray-200 text-sm text-gray-700 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        >
          {PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="flex items-center gap-6">
        <div className="flex items-center bg-gray-50 border border-gray-200 rounded-md px-3 py-1.5 focus-within:ring-2 focus-within:ring-blue-500">
          <Search size={16} className="text-gray-400 mr-2" />
          <input type="text" placeholder="Search..." className="bg-transparent border-none text-sm outline-none text-gray-700 placeholder-gray-400 w-48" />
        </div>
        <button className="text-gray-400 hover:text-gray-600 relative">
          <Bell size={20} />
          <span className="absolute top-0 right-0 w-2 h-2 bg-red-500 rounded-full border border-white"></span>
        </button>
        
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-2 hover:bg-gray-50 p-1.5 rounded-lg border border-transparent hover:border-gray-200 transition-all focus:outline-none shadow-sm"
          >
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm shadow-inner">
              JD
            </div>
            <div className="text-left hidden md:block select-none">
              <div className="text-xs font-bold text-gray-800 leading-tight">J. Doe</div>
              <div className="text-[11.25px] font-semibold text-blue-600 mt-0.5 flex items-center gap-1">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                {selectedPersona}
              </div>
            </div>
            <svg
              className={`h-4.5 w-4.5 text-gray-400 transition-transform duration-250 ml-0.5 ${dropdownOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {dropdownOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)}></div>
              <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-xl z-50 py-2 animate-fade-in-dropdown select-none">
                <div className="px-4 py-2 border-b border-gray-100 mb-1.5">
                  <span className="text-[11.25px] font-bold text-gray-400 uppercase tracking-widest block">Active Profile</span>
                  <span className="text-sm font-extrabold text-gray-800 block mt-0.5">J. Doe</span>
                  <span className="inline-flex items-center gap-1.5 bg-blue-50 text-blue-700 text-[11.25px] px-2 py-0.5 rounded-full font-bold mt-1.5">
                    {selectedPersona}
                  </span>
                </div>
                <div className="px-4 py-1 text-[11.25px] font-bold text-gray-400 uppercase tracking-wider">
                  Switch Persona
                </div>
                <ul className="space-y-0.5 mt-1">
                  {['Plant Manager', 'Plant Operator', 'Quality Engineer'].map((role) => (
                    <li key={role}>
                      <button
                        onClick={() => {
                          setSelectedPersona(role);
                          setDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2 text-sm font-semibold flex items-center justify-between transition-colors border-l-4 ${
                          selectedPersona === role
                            ? 'text-blue-600 bg-blue-50/70 border-blue-600 pl-3'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 border-transparent'
                        }`}
                      >
                        <span>{role}</span>
                        {selectedPersona === role && (
                          <svg className="h-3 w-3 text-blue-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function AppContent() {
  const location = useLocation();
  const navigate = useNavigate();
  const { selectedPersona } = useFilter();

  useEffect(() => {
    const config = PERSONA_CONFIGS[selectedPersona];
    if (!config) return;

    const currentPath = location.pathname;

    if (currentPath === '/' || currentPath === '/dashboard') {
      if (selectedPersona !== 'Plant Manager') {
        navigate(config.landingPage, { replace: true });
      }
    } else {
      const isAllowed = config.visiblePages.includes(currentPath);
      if (!isAllowed) {
        navigate(config.landingPage, { replace: true });
      }
    }
  }, [selectedPersona, location.pathname, navigate]);

  return (
    <div className="flex h-screen w-full bg-gray-50 font-sans overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <div key={selectedPersona} className="animate-fade-in-content h-full">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/batch-explorer" element={<BatchExplorer />} />
              <Route path="/process-monitoring" element={<ProcessMonitoring />} />
              <Route path="/golden-batch" element={<GoldenBatch />} />
              <Route path="/kpi-deviation-prediction" element={<KpiDeviationPrediction />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/review-desk" element={<ReviewDesk />} />
              <Route path="/ai-copilot" element={<AiCopilot />} />
              <Route path="*" element={<div className="max-w-7xl mx-auto"><h2 className="text-xl text-gray-500 text-center mt-20">Page is under construction.</h2></div>} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <FilterProvider>
        <AppContent />
      </FilterProvider>
    </BrowserRouter>
  );
}

export default App;
