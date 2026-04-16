import React, { useState, useEffect, useRef } from 'react';

interface NavbarProps {
  onNavigate: (path: string) => void;
  currentPath: string;
}

const Navbar: React.FC<NavbarProps> = ({ onNavigate, currentPath }) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const links = [
    { label: 'Home', path: '/' },
    { label: 'Onboard Product', path: '/onboard' },
    { label: 'Catalog', path: '/catalog' },
    { label: '.well-known', path: '/well-known' },
  ];

  const externalLinks = [
    { label: 'VyEx', href: '/vyex/' },
    { label: 'TexFlow', href: '/' },
  ];

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMobileOpen(false);
      }
    };
    if (mobileOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [mobileOpen]);

  const handleNavigate = (path: string) => {
    onNavigate(path);
    setMobileOpen(false);
  };

  return (
    <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => handleNavigate('/')}>
            <div className="h-12 w-12 rounded-full overflow-hidden ring-2 ring-slate-700/80 flex-shrink-0 bg-slate-900 flex items-center justify-center">
              <img src="/Platform66.png" alt="Platform66" className="h-full w-full object-cover" />
            </div>
            <span className="text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              Platform66
            </span>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-6">
            <div className="flex items-baseline space-x-4">
              {links.map((link) => (
                <button
                  key={link.path}
                  onClick={() => handleNavigate(link.path)}
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
              {externalLinks.map((l) => (
                <a key={l.href} href={l.href} className="text-slate-400 hover:text-white transition-colors">{l.label}</a>
              ))}
            </div>
          </div>

          {/* Hamburger button */}
          <button
            className="md:hidden flex flex-col justify-center gap-[5px] p-2 rounded-lg text-slate-300 hover:bg-slate-800 transition-colors"
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            <span
              className={`block w-5 h-0.5 bg-current rounded transition-transform duration-200 ${mobileOpen ? 'translate-y-[7px] rotate-45' : ''}`}
            />
            <span
              className={`block w-5 h-0.5 bg-current rounded transition-all duration-200 ${mobileOpen ? 'opacity-0 scale-x-0' : ''}`}
            />
            <span
              className={`block w-5 h-0.5 bg-current rounded transition-transform duration-200 ${mobileOpen ? '-translate-y-[7px] -rotate-45' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          ref={menuRef}
          className="md:hidden border-t border-slate-800 bg-slate-900/95 backdrop-blur-md"
        >
          <div className="px-4 py-3 space-y-1">
            {links.map((link) => (
              <button
                key={link.path}
                onClick={() => handleNavigate(link.path)}
                className={`w-full text-left px-3 py-2.5 rounded-md text-sm font-medium transition-all ${
                  currentPath === link.path
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {link.label}
              </button>
            ))}
            <div className="h-px bg-slate-800 my-2" />
            {externalLinks.map((l) => (
              <a
                key={l.href}
                href={l.href}
                className="block px-3 py-2.5 rounded-md text-sm font-medium text-slate-400 hover:bg-slate-800 hover:text-white transition-all"
              >
                {l.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
