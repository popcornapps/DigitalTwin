import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Search, Bell, User, Activity, FileText, Settings, Database, BrainCircuit, BarChart3, TrendingUp, AlertTriangle } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import BatchExplorer from './pages/BatchExplorer';
import ProcessMonitoring from './pages/ProcessMonitoring';
import GoldenBatch from './pages/GoldenBatch';
import AnomalyIntelligence from './pages/AnomalyIntelligence';
import QualityWorkbench from './pages/QualityWorkbench';
import AiCopilot from './pages/AiCopilot';

function Sidebar() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path || (path === '/dashboard' && location.pathname === '/');

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: <BarChart3 size={20} /> },
    { name: 'Batch Explorer', path: '/batch-explorer', icon: <Database size={20} /> },
    { name: 'Process Monitoring', path: '/process-monitoring', icon: <TrendingUp size={20} /> },
    { name: 'Golden Batch', path: '/golden-batch', icon: <FileText size={20} /> },
    { name: 'Anomaly Intel', path: '/anomaly-intelligence', icon: <AlertTriangle size={20} /> },
    { name: 'Quality Workbench', path: '/quality-workbench', icon: <Activity size={20} /> },
    { name: 'AI Copilot', path: '/ai-copilot', icon: <BrainCircuit size={20} /> },
  ];

  return (
    <nav className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="h-16 flex items-center px-6 border-b border-gray-200">
        <Activity className="text-blue-600 mr-3" size={24} />
        <h2 className="text-lg font-bold text-gray-900 tracking-tight">PharmaTwin</h2>
      </div>
      <ul className="flex-1 py-4 space-y-1">
        {navItems.map((item) => (
          <li key={item.path}>
            <Link 
              to={item.path} 
              className={`flex items-center gap-3 px-6 py-2.5 text-sm font-medium transition-colors ${
                isActive(item.path) 
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
      <div className="p-4 border-t border-gray-200">
        <Link to="/settings" className="flex items-center gap-3 px-2 py-2 text-sm font-medium text-gray-600 hover:text-gray-900">
          <Settings size={20} /> Settings
        </Link>
      </div>
    </nav>
  );
}

function Header() {
  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0">
      <div className="flex gap-4">
        <select className="bg-gray-50 border border-gray-200 text-sm text-gray-700 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option>Hyderabad Plant</option>
        </select>
        <select className="bg-gray-50 border border-gray-200 text-sm text-gray-700 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option>Line 03</option>
        </select>
        <select className="bg-gray-50 border border-gray-200 text-sm text-gray-700 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option>Paracetamol 500mg</option>
        </select>
        <select className="bg-gray-50 border border-gray-200 text-sm text-gray-700 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium">
          <option>BT-2026-018</option>
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
        <div className="flex items-center gap-2 cursor-pointer">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700">
            <User size={16} />
          </div>
          <span className="text-sm font-medium text-gray-700">J. Doe</span>
        </div>
      </div>
    </header>
  );
}



function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen w-full bg-gray-50 font-sans overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          <main className="flex-1 overflow-y-auto p-6">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/batch-explorer" element={<BatchExplorer />} />
              <Route path="/process-monitoring" element={<ProcessMonitoring />} />
              <Route path="/golden-batch" element={<GoldenBatch />} />
              <Route path="/anomaly-intelligence" element={<AnomalyIntelligence />} />
              <Route path="/quality-workbench" element={<QualityWorkbench />} />
              <Route path="/ai-copilot" element={<AiCopilot />} />
              <Route path="*" element={<div className="max-w-7xl mx-auto"><h2 className="text-xl text-gray-500 text-center mt-20">Page is under construction.</h2></div>} />
            </Routes>
          </main>
        </div>
      </div>
    </BrowserRouter>
  );
}

export default App;
