import React, { createContext, useContext, useState, useEffect } from 'react';

// Single-plant, single-product POC scope - see docs/data-architecture.md and
// docs/data-coverage-audit.md: Amoxicillin/Ibuprofen and Pune/Chennai never
// had real generated batch data behind them, only hardcoded mock numbers.
export const PLANTS = ['Hyderabad Plant'];
export const PRODUCTS = ['Paracetamol 500mg'];


interface FilterContextType {
  selectedPlant: string;
  setSelectedPlant: (val: string) => void;
  selectedProduct: string;
  setSelectedProduct: (val: string) => void;
  selectedBatch: string;
  setSelectedBatch: (val: string) => void;
  availableBatches: string[];
  selectedPersona: string;
  setSelectedPersona: (val: string) => void;
}

const FilterContext = createContext<FilterContextType | undefined>(undefined);

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [selectedPlant, setSelectedPlant] = useState(PLANTS[0]);
  const [selectedProduct, setSelectedProduct] = useState(PRODUCTS[0]);
  const [selectedPersona, setSelectedPersona] = useState('Plant Manager');

  // Generate dummy batches based on plant and product strings to ensure they are unique
  const generateBatches = (plant: string, product: string) => {
    const pCode = product.substring(0, 3).toUpperCase();
    const plCode = plant.substring(0, 3).toUpperCase();
    return [
      'All Batches',
      `${plCode}-${pCode}-018`,
      `${plCode}-${pCode}-017`,
      `${plCode}-${pCode}-016`,
      `${plCode}-${pCode}-015`
    ];
  };

  const [availableBatches, setAvailableBatches] = useState(generateBatches(PLANTS[0], PRODUCTS[0]));
  const [selectedBatch, setSelectedBatch] = useState(availableBatches[0]);

  // When plant changes, reset product
  const prevPlant = React.useRef(selectedPlant);
  useEffect(() => {
    if (prevPlant.current !== selectedPlant) {
      setSelectedProduct(PRODUCTS[0]);
      prevPlant.current = selectedPlant;
    }
  }, [selectedPlant]);

  // When product or plant changes, update available batches and reset selected batch
  useEffect(() => {
    const batches = generateBatches(selectedPlant, selectedProduct);
    setAvailableBatches(batches);
    if (batches.length > 0) {
      setSelectedBatch(batches[0]);
    }
  }, [selectedPlant, selectedProduct]);

  return (
    <FilterContext.Provider
      value={{
        selectedPlant, setSelectedPlant,
        selectedProduct, setSelectedProduct,
        selectedBatch, setSelectedBatch,
        availableBatches,
        selectedPersona, setSelectedPersona
      }}
    >
      {children}
    </FilterContext.Provider>
  );
}

export function useFilter() {
  const context = useContext(FilterContext);
  if (!context) {
    throw new Error('useFilter must be used within a FilterProvider');
  }
  return context;
}
