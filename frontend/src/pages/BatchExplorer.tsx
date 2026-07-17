import { useState, useMemo } from 'react';
import { getMockBatchHistory } from '../lib/mockData';
import { Search } from 'lucide-react';
import { useFilter } from '../context/FilterContext';

export default function BatchExplorer() {
  const { selectedPlant, selectedProduct, setSelectedBatch } = useFilter();
  const mockBatchHistory = getMockBatchHistory(selectedPlant, selectedProduct);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [yieldSort, setYieldSort] = useState('None');
  const [qualitySort, setQualitySort] = useState('None');

  const filteredAndSortedBatches = useMemo(() => {
    let result = [...mockBatchHistory];

    // Search filter
    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(b => 
        b.id.toLowerCase().includes(s) || 
        b.product.toLowerCase().includes(s)
      );
    }

    // Status filter
    if (statusFilter !== 'All') {
      if (statusFilter === 'Running') {
        result = result.filter(b => b.status === 'In Progress');
      } else if (statusFilter === 'Completed') {
        result = result.filter(b => b.status === 'Completed');
      }
    }

    // Extract numbers for sorting
    const parseValue = (val: string) => {
      if (val === '-' || !val) return -1;
      return parseFloat(val.replace('%', ''));
    };

    // Sorting overrides (Yield gets priority if active, then Quality, otherwise ID)
    if (yieldSort !== 'None') {
      result.sort((a, b) => {
        const vA = parseValue(a.yield);
        const vB = parseValue(b.yield);
        return yieldSort === 'Highest' ? vB - vA : vA - vB;
      });
    } else if (qualitySort !== 'None') {
      result.sort((a, b) => {
        const vA = parseValue(a.quality);
        const vB = parseValue(b.quality);
        return qualitySort === 'Highest' ? vB - vA : vA - vB;
      });
    }

    return result;
  }, [mockBatchHistory, search, statusFilter, yieldSort, qualitySort]);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Batch Explorer</h1>
          <p className="text-sm text-gray-500">Browsing batches for {selectedPlant} | {selectedProduct}</p>
        </div>
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center bg-white border border-gray-200 rounded-md px-3 py-2">
            <Search size={16} className="text-gray-400 mr-2" />
            <input 
              type="text" 
              placeholder="Search batches..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-sm outline-none w-48" 
            />
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase">Status:</span>
            <select 
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-white border border-gray-200 text-sm text-gray-700 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="All">All</option>
              <option value="Running">Running</option>
              <option value="Completed">Completed</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase">Yield:</span>
            <select 
              value={yieldSort}
              onChange={(e) => { setYieldSort(e.target.value); setQualitySort('None'); }}
              className="bg-white border border-gray-200 text-sm text-gray-700 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="None">-</option>
              <option value="Highest">Highest</option>
              <option value="Lowest">Lowest</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-gray-500 uppercase">Quality:</span>
            <select 
              value={qualitySort}
              onChange={(e) => { setQualitySort(e.target.value); setYieldSort('None'); }}
              className="bg-white border border-gray-200 text-sm text-gray-700 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="None">-</option>
              <option value="Highest">Highest</option>
              <option value="Lowest">Lowest</option>
            </select>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-left text-sm text-gray-600">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-700 uppercase">
            <tr>
              <th className="px-6 py-4 font-semibold">Batch ID</th>
              <th className="px-6 py-4 font-semibold">Product</th>
              <th className="px-6 py-4 font-semibold">Start Time</th>
              <th className="px-6 py-4 font-semibold">End Time</th>
              <th className="px-6 py-4 font-semibold">Status</th>
              <th className="px-6 py-4 font-semibold">Yield</th>
              <th className="px-6 py-4 font-semibold">Quality</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filteredAndSortedBatches.map((batch) => (
              <tr key={batch.id} className="hover:bg-gray-50" onClick={() => setSelectedBatch(batch.id)}>
                <td className="px-6 py-4 font-medium text-blue-600 cursor-pointer">{batch.id}</td>
                <td className="px-6 py-4">{batch.product}</td>
                <td className="px-6 py-4">{batch.start}</td>
                <td className="px-6 py-4">{batch.end}</td>
                <td className="px-6 py-4">
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${batch.status === 'Completed' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                    {batch.status}
                  </span>
                </td>
                <td className="px-6 py-4 font-medium text-gray-900">{batch.yield}</td>
                <td className="px-6 py-4 font-medium text-gray-900">{batch.quality}</td>
              </tr>
            ))}
            {filteredAndSortedBatches.length === 0 && (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-gray-500">
                  No batches found matching the selected criteria.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
