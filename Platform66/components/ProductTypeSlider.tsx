import React from 'react';

export type ProductKind = 'digital' | 'hardware' | 'api';

export const PRODUCT_KIND_OPTIONS: { value: ProductKind; label: string }[] = [
  { value: 'digital', label: 'Digital product/service' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'api', label: 'API' },
];

export interface ProductTypeSliderProps {
  value: ProductKind;
  onChange: (value: ProductKind) => void;
}

/** Maps UI product kind to AA type and catalog category (used for catalog grouping). */
export function productKindToTypeAndCategory(kind: ProductKind): { type: 'software' | 'hardware' | 'api'; category: string } {
  switch (kind) {
    case 'digital':
      return { type: 'software', category: 'Digital Products' };
    case 'hardware':
      return { type: 'hardware', category: 'Hardware' };
    case 'api':
      return { type: 'api', category: 'API' };
  }
}

const ProductTypeSlider: React.FC<ProductTypeSliderProps> = ({ value, onChange }) => {
  const activeIndex = PRODUCT_KIND_OPTIONS.findIndex(o => o.value === value);
  const safeIndex = activeIndex >= 0 ? activeIndex : 0;

  return (
    <div className="w-full">
      <label className="block text-sm font-medium text-slate-300 mb-3">Product type</label>
      <div
        className="relative rounded-xl p-1.5 flex overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #14532d 0%, #166534 30%, #15803d 50%, #22c55e 80%, #16a34a 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 14px rgba(0,0,0,0.35)',
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
          }}
        />
        <div className="relative flex flex-1 rounded-lg bg-slate-900/30 overflow-hidden">
          {PRODUCT_KIND_OPTIONS.map((opt, i) => {
            const isActive = safeIndex === i;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onChange(opt.value)}
                className="flex-1 flex items-center justify-center py-3.5 px-4 text-sm font-semibold transition-all duration-250 rounded-lg border border-transparent"
                style={{
                  backgroundColor: isActive ? 'rgba(34, 197, 94, 0.4)' : 'transparent',
                  color: isActive ? '#fff' : 'rgba(226, 232, 240, 0.8)',
                  boxShadow: isActive ? 'inset 0 0 0 1px rgba(34, 197, 94, 0.6), 0 1px 2px rgba(0,0,0,0.2)' : 'none',
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default ProductTypeSlider;
