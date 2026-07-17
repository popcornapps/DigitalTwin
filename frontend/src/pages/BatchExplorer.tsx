import { mockBatchHistory } from '../lib/mockData';
import { Search, Filter } from 'lucide-react';

export default function BatchExplorer() {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Batch Explorer</h1>
          <p className="text-sm text-gray-500">Search and review historical batches</p>
        </div>
        <div className="flex gap-4">
          <div className="flex items-center bg-white border border-gray-200 rounded-md px-3 py-2">
            <Search size={16} className="text-gray-400 mr-2" />
            <input type="text" placeholder="Search batches..." className="text-sm outline-none w-48" />
          </div>
          <button className="flex items-center gap-2 bg-white border border-gray-200 rounded-md px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
            <Filter size={16} /> Filter
          </button>
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
            {mockBatchHistory.map((batch) => (
              <tr key={batch.id} className="hover:bg-gray-50">
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
          </tbody>
        </table>
      </div>
    </div>
  );
}
