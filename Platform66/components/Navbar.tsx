import React from 'react';

interface NavbarProps {
  onNavigate: (path: string) => void;
  currentPath: string;
}

const Navbar: React.FC<NavbarProps> = ({ onNavigate, currentPath }) => {
  const links = [
    { label: 'Home', path: '/' },
    { label: 'Onboard Product', path: '/onboard' },
    { label: 'Catalog', path: '/catalog' },
    { label: '.well-known', path: '/well-known' },
  ];

  return (
    <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => onNavigate('/')}>
            <div className="h-12 w-12 rounded-full overflow-hidden ring-2 ring-slate-700/80 flex-shrink-0 bg-slate-900 flex items-center justify-center">
              <img src="/Platform66.png" alt="Platform66" className="h-full w-full object-cover" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              Platform66
            </span>
          </div>
          <div className="hidden md:flex items-center gap-6">
            <div className="flex items-baseline space-x-4">
              {links.map((link) => (
                <button
                  key={link.path}
                  onClick={() => onNavigate(link.path)}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-all ${
                    currentPath === link.path
                      ? 'bg-slate-800 text-white shadow-inner'
                      : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {link.label}
                </button>
              ))}
            </div>
            <div className="border-l border-slate-700 pl-4 flex items-baseline gap-3 text-sm">
              <a href="/vy-experts/" className="text-slate-400 hover:text-white transition-colors">Vy Experts</a>
              <a href="/" className="text-slate-400 hover:text-white transition-colors">TexFlow</a>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
