import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ChevronDown, Settings, LayoutDashboard, Tally5, Landmark, Store, FileText, Library, Archive, MessageSquare, Users, Newspaper, Home as HomeIcon, Heart, HelpCircle, Headphones as Headset, Grid, BookOpen, LogOut, Scale, Gavel, Shield, Vote, Eye, ShieldCheck, HeartHandshake as Handcuffs, Map, Siren, Wifi, Zap, Droplet, Smartphone, Wrench, LogIn, UserPlus, Flame, GraduationCap, Briefcase, Building2 } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import NotificationBell from '@/components/NotificationBell';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import DashboardSelectorDialog from '@/components/dashboard/DashboardSelectorDialog';
import { SERVICE_CATEGORIES } from '@/lib/serviceCatalog';

const serviceCategories = SERVICE_CATEGORIES;

const SERVICE_INITIALS_IGNORED_WORDS = new Set(['a', 'as', 'da', 'das', 'de', 'do', 'dos', 'e', 'o', 'os']);

const getServiceInitials = (name = '') => {
  const words = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/\s+/)
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase())
    .filter((word) => word && !SERVICE_INITIALS_IGNORED_WORDS.has(word));

  return words.map((word) => word[0]).join('').toUpperCase() || name.slice(0, 1).toUpperCase();
};

const formatServiceMenuLabel = (serviceName) => `${serviceName} (${getServiceInitials(serviceName)})`;

const helpLinks = [
    { name: 'Contato e Suporte', path: '/support', icon: Headset, color: "text-blue-400" },
    { name: 'FAQ', path: '/faq', icon: HelpCircle, color: "text-yellow-400" },
    { name: 'Docs', path: '/docs', icon: BookOpen, color: "text-green-400" },
    { name: 'Sobre Nós', path: '/about', icon: BookOpen, color: "text-purple-400" },
];

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileServicesOpen, setMobileServicesOpen] = useState(false);
  const [isDashboardAlertOpen, setIsDashboardAlertOpen] = useState(false);
  
  const { user, logout, session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

  const servicesTimeoutRef = useRef(null);
  const helpTimeoutRef = useRef(null);
  const navRef = useRef(null);
  const mobileNavRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  useEffect(() => {
    const handleClickOutside = (event) => {
      const clickedTopNavigation = navRef.current?.contains(event.target);
      const clickedMobileNavigation = mobileNavRef.current?.contains(event.target);

      if (!clickedTopNavigation && !clickedMobileNavigation) {
        setServicesOpen(false);
        setHelpOpen(false);
        setMobileServicesOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.documentElement.classList.add('menu-open');
    } else {
      document.documentElement.classList.remove('menu-open');
    }
    return () => document.documentElement.classList.remove('menu-open');
  }, [isOpen]);

  useEffect(() => {
    setIsOpen(false);
    setServicesOpen(false);
    setHelpOpen(false);
    setMobileServicesOpen(false);
  }, [location.pathname]);

  const navLinks = [
      { name: 'Início', path: '/', icon: HomeIcon },
      { name: 'Serviços', path: '/services', icon: LayoutDashboard, isDropdown: true, type: 'services' },
      { name: 'Sobre o País', path: '/country-info', icon: Map },
      { name: 'Comunidade', path: '/community', icon: Users },
      { name: 'Ajuda', path: '#', icon: HelpCircle, isDropdown: true, type: 'help' },
  ];
  
  const handleLogout = async () => {
    await logout();
    toast({ title: 'Você saiu da sua conta.' });
    navigate('/');
  };
  const effectiveRoles = Array.isArray(user?.effective_roles) ? user.effective_roles : [user?.role].filter(Boolean);
  const hasPresidentAccess = effectiveRoles.includes('Presidente');
  const isAdmin = effectiveRoles.includes('Admin') || user?.role === 'Admin';
  
  const handleServicesEnter = () => { clearTimeout(servicesTimeoutRef.current); setServicesOpen(true); };
  const handleServicesLeave = () => { servicesTimeoutRef.current = setTimeout(() => setServicesOpen(false), 200); };
  const handleServicesClick = (e) => { e.preventDefault(); setServicesOpen(prev => !prev); };

  const handleHelpEnter = () => { clearTimeout(helpTimeoutRef.current); setHelpOpen(true); };
  const handleHelpLeave = () => { helpTimeoutRef.current = setTimeout(() => setHelpOpen(false), 200); };
  const handleHelpClick = (e) => { e.preventDefault(); setHelpOpen(prev => !prev); };

  const openDashboard = () => {
    if (!session) {
      navigate('/login');
      return;
    }

    if (isAdmin || hasPresidentAccess) {
      setIsDashboardAlertOpen(true);
    } else {
      navigate('/dashboard/citizen');
    }
  };

  const handleDashboardClick = (event) => {
    event?.preventDefault();
    openDashboard();
  };

  const NavLink = ({ to, children, className, icon: Icon }) => (
    <Link to={to} className={`flex items-center gap-2 relative text-foreground hover:text-primary transition-colors duration-300 font-medium ${className}`}>
      {Icon && <Icon className="w-4 h-4"/>}
      {children}
      {location.pathname === to && (
        <motion.div className="absolute -bottom-2 left-0 right-0 h-0.5 bg-primary" layoutId="underline" initial={false} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
      )}
    </Link>
  );

  return (
    <>
      <motion.nav ref={navRef} initial={{ y: -100 }} animate={{ y: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }} className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${isScrolled || isOpen ? 'bg-background/95 backdrop-blur-lg border-b border-border' : 'bg-transparent'}`}>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <Link to="/" className="flex items-center space-x-2">
              <motion.div
                whileHover={{ scale: 1.1, rotate: -5 }}
                style={{
                  textShadow: '1px 1px 0px #8B5CF6, 2px 2px 0px #6D28D9, 3px 3px 0px rgba(0,0,0,0.3)'
                }}
                className="text-3xl font-bold text-foreground"
              >
                GOV.RP
              </motion.div>
            </Link>

            <div className="hidden md:flex items-center space-x-6">
              {navLinks.map(link => {
                if (link.isDropdown) {
                  if (link.type === 'services') {
                    return (
                      <div key={link.name} className="relative" onMouseEnter={handleServicesEnter} onMouseLeave={handleServicesLeave}>
                        <button onClick={handleServicesClick} className="flex items-center gap-2 text-foreground hover:text-primary transition-colors cursor-pointer font-medium"><LayoutDashboard className="w-4 h-4" /><span>{link.name}</span><ChevronDown className={`w-4 h-4 transition-transform ${servicesOpen ? 'rotate-180' : ''}`} /></button>
                        <AnimatePresence>
                          {servicesOpen && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute top-full left-1/2 -translate-x-1/2 mt-4 grid grid-cols-2 gap-1 w-[32rem] bg-popover border border-border rounded-lg shadow-2xl p-2 max-h-[70vh] overflow-y-auto custom-scrollbar">
                               {serviceCategories.map((category) => (
                                 <div key={category.name} className="p-2">
                                   <h3 className="font-semibold text-sm text-muted-foreground px-2 mb-2">{category.name}</h3>
                                    {category.services.map((service) => (
                                      <Link key={service.path} to={service.path} className="flex items-center space-x-3 px-2 py-2 text-sm hover:bg-accent transition-colors rounded-md text-popover-foreground">
                                        <service.icon className={`w-4 h-4 ${service.color}`}/><span>{formatServiceMenuLabel(service.name)}</span>
                                      </Link>
                                    ))}
                                 </div>
                               ))}
                               <div className="col-span-2 border-t border-border mt-1 pt-1">
                                   <Link to="/services" className="flex items-center justify-center space-x-2 p-2 hover:bg-accent transition-colors rounded-md text-primary font-semibold"><Grid className="w-4 h-4"/><span>Ver Todos os Serviços</span></Link>
                               </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )
                  }
                  if (link.type === 'help') {
                    return (
                      <div key={link.name} className="relative" onMouseEnter={handleHelpEnter} onMouseLeave={handleHelpLeave}>
                        <button onClick={handleHelpClick} className="flex items-center gap-2 text-foreground hover:text-primary transition-colors cursor-pointer font-medium"><HelpCircle className="w-4 h-4" /><span>{link.name}</span><ChevronDown className={`w-4 h-4 transition-transform ${helpOpen ? 'rotate-180' : ''}`} /></button>
                        <AnimatePresence>
                          {helpOpen && (
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute top-full left-1/2 -translate-x-1/2 mt-4 w-48 bg-popover border border-border rounded-lg shadow-2xl p-2">
                                {helpLinks.map((helpLink) => (
                                  <Link key={helpLink.path} to={helpLink.path} className="flex items-center space-x-3 px-2 py-2 text-sm hover:bg-accent transition-colors rounded-md text-popover-foreground">
                                    <helpLink.icon className={`w-4 h-4 ${helpLink.color}`}/><span>{helpLink.name}</span>
                                  </Link>
                                ))}
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    )
                  }
                }
                return <NavLink key={link.path} to={link.path} icon={link.icon}>{link.name}</NavLink>
              })}
            </div>

            <div className="hidden md:flex items-center space-x-2">
              {user && <Link to="/support-us"><Button variant="outline" className="border-purple-400/50 text-purple-300 hover:bg-purple-400/10 hover:text-purple-300"><Heart className="w-4 h-4 mr-2"/>Apoiar</Button></Link>}
              {session ? (
                <>
                  <NotificationBell />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="flex items-center space-x-2 text-foreground hover:text-primary transition-colors">
                        <img src={user?.avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${user?.username}`} alt="User avatar" className="w-8 h-8 rounded-full object-cover bg-secondary" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-56 mr-4">
                      <DropdownMenuLabel>
                        <p className="text-sm text-muted-foreground">Logado como</p>
                        <p className="font-semibold truncate">{user?.full_name}</p>
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleDashboardClick} className="flex items-center w-full cursor-pointer"><LayoutDashboard className="w-4 h-4 mr-2 text-blue-400" /><span>Dashboard</span></DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to="/settings" className="flex items-center w-full cursor-pointer"><Settings className="w-4 h-4 mr-2 text-muted-foreground" /><span>Configurações</span></Link>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={handleLogout} className="text-red-400 focus:text-red-400 focus:bg-red-500/10 cursor-pointer">
                        <LogOut className="w-4 h-4 mr-2" /><span>Sair</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </>
              ) : (
                <>
                  <Link to="/support-us"><Button variant="outline" className="border-purple-400/50 text-purple-300 hover:bg-purple-400/10 hover:text-purple-300"><Heart className="w-4 h-4 mr-2"/>Apoiar</Button></Link>
                  <Link to="/login"><Button variant="ghost" className="text-foreground hover:bg-accent hover:text-accent-foreground"><LogIn className="w-4 h-4 mr-2"/>Entrar</Button></Link>
                  <Link to="/register"><Button className="bg-primary text-primary-foreground hover:bg-primary/90"><UserPlus className="w-4 h-4 mr-2"/>Cadastrar</Button></Link>
                </>
              )}
            </div>
            
            <div className="flex items-center md:hidden">
              {user && <NotificationBell />}
              <button
                type="button"
                aria-label={isOpen ? 'Fechar menu' : 'Abrir menu'}
                onClick={() => {
                  setMobileServicesOpen(false);
                  setIsOpen(!isOpen);
                }}
                className="text-foreground hover:text-primary transition-colors z-[101] relative ml-2"
              >
                {isOpen ? <X className="w-7 h-7" /> : <Menu className="w-7 h-7" />}
              </button>
            </div>
          </div>
        </div>
      </motion.nav>
      <MobileMenu isOpen={isOpen} setIsOpen={setIsOpen} />
      {!location.pathname.startsWith('/services/x') && (
        <MobileBottomNav
          containerRef={mobileNavRef}
          servicesOpen={mobileServicesOpen}
          setServicesOpen={setMobileServicesOpen}
          onDashboard={openDashboard}
        />
      )}
      <DashboardSelectorDialog
        open={isDashboardAlertOpen}
        onOpenChange={setIsDashboardAlertOpen}
        onSelect={(path) => {
          setIsDashboardAlertOpen(false);
          navigate(path);
        }}
        hasPresidentAccess={hasPresidentAccess}
        isAdmin={isAdmin}
      />
    </>
  );
};

const MobileBottomNav = ({
  containerRef,
  servicesOpen,
  setServicesOpen,
  onDashboard,
}) => {
  const location = useLocation();
  const isServicesRoute = location.pathname === '/services' || location.pathname.startsWith('/services/');
  const isDashboardRoute =
    location.pathname === '/dashboard' ||
    location.pathname.startsWith('/dashboard/') ||
    location.pathname.startsWith('/admin-dashboard/');

  const itemClass = (active) =>
    `relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[0.68rem] font-medium transition-colors ${
      active
        ? 'text-primary'
        : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
    }`;

  return (
    <div ref={containerRef} className="md:hidden">
      <AnimatePresence>
        {servicesOpen && (
          <>
            <motion.button
              type="button"
              aria-label="Fechar menu de serviços"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setServicesOpen(false)}
              className="fixed inset-0 z-[55] cursor-default bg-background/45 backdrop-blur-[2px]"
            />
            <motion.section
              id="mobile-services-menu"
              aria-label="Serviços"
              initial={{ opacity: 0, y: 18, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 18, scale: 0.98 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="custom-scrollbar fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[70] mx-auto max-h-[calc(100dvh-10rem)] max-w-lg overflow-y-auto rounded-2xl border border-border/90 bg-popover/95 p-3 text-popover-foreground shadow-2xl backdrop-blur-xl"
            >
              <div className="sticky -top-3 z-10 mb-2 flex items-center justify-between border-b border-border bg-popover/95 px-2 py-3 backdrop-blur-xl">
                <div>
                  <p className="text-sm font-semibold">Serviços GOV.RP</p>
                  <p className="text-xs text-muted-foreground">Escolha uma área da plataforma</p>
                </div>
                <Link
                  to="/services"
                  onClick={() => setServicesOpen(false)}
                  className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-primary hover:bg-accent"
                >
                  <Grid className="h-4 w-4" />
                  Ver todos
                </Link>
              </div>

              <div className="space-y-3">
                {serviceCategories.map((category) => (
                  <div key={category.name}>
                    <h3 className="px-2 pb-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {category.name}
                    </h3>
                    <div className="grid grid-cols-1 gap-1 min-[430px]:grid-cols-2">
                      {category.services.map((service) => (
                        <Link
                          key={service.path}
                          to={service.path}
                          onClick={() => setServicesOpen(false)}
                          className="flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors hover:bg-accent"
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-background/70">
                            <service.icon className={`h-4 w-4 ${service.color}`} />
                          </span>
                          <span className="min-w-0 truncate">{formatServiceMenuLabel(service.name)}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </motion.section>
          </>
        )}
      </AnimatePresence>

      <nav
        aria-label="Navegação principal móvel"
        className="fixed inset-x-0 bottom-0 z-[70] border-t border-border/90 bg-background/95 px-2 pt-1 shadow-[0_-12px_35px_rgba(0,0,0,0.32)] backdrop-blur-xl"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 0.25rem)' }}
      >
        <div className="mx-auto grid h-[4.5rem] max-w-lg grid-cols-4 gap-1">
          <Link
            to="/"
            aria-current={location.pathname === '/' ? 'page' : undefined}
            className={itemClass(location.pathname === '/')}
          >
            <HomeIcon className="h-5 w-5" />
            <span className="truncate">Início</span>
          </Link>

          <button
            type="button"
            aria-expanded={servicesOpen}
            aria-controls="mobile-services-menu"
            onClick={() => setServicesOpen((open) => !open)}
            className={itemClass(servicesOpen || isServicesRoute)}
          >
            <span className="relative">
              <LayoutDashboard className="h-5 w-5" />
              <ChevronDown
                className={`absolute -right-3 -top-1 h-3 w-3 transition-transform ${
                  servicesOpen ? '' : 'rotate-180'
                }`}
              />
            </span>
            <span className="truncate">Serviços</span>
          </button>

          <button
            type="button"
            aria-current={isDashboardRoute ? 'page' : undefined}
            onClick={() => {
              setServicesOpen(false);
              onDashboard();
            }}
            className={itemClass(isDashboardRoute)}
          >
            <LayoutDashboard className="h-5 w-5" />
            <span className="truncate">Dashboard</span>
          </button>

          <Link
            to="/country-info"
            aria-current={location.pathname === '/country-info' ? 'page' : undefined}
            className={itemClass(location.pathname === '/country-info')}
          >
            <Map className="h-5 w-5" />
            <span className="truncate">Sobre o país</span>
          </Link>
        </div>
      </nav>
    </div>
  );
};

const MobileMenu = ({ isOpen, setIsOpen }) => {
  const { user, logout, session } = useAuth();
  const [openSubmenu, setOpenSubmenu] = useState(null);
  const navigate = useNavigate();

  const handleLogout = async () => {
    setIsOpen(false);
    await logout();
    navigate('/');
  };

  const mainLinks = [
    { name: 'Comunidade', path: '/community', icon: Users },
    { name: 'Apoie o Projeto', path: '/support-us', icon: Heart },
  ];
  
  const NavLink = ({ to, children, icon: Icon, onClick }) => (
    <Link to={to} onClick={onClick} className="text-xl p-4 rounded-lg hover:bg-accent flex items-center w-full text-foreground gap-4">
      <Icon className="w-6 h-6"/>
      {children}
    </Link>
  );

  const toggleSubmenu = (name) => {
    setOpenSubmenu(openSubmenu === name ? null : name);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="md:hidden fixed inset-0 z-[100] bg-background/95 backdrop-blur-lg"
          onClick={() => setIsOpen(false)}
        >
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="absolute top-0 right-0 h-full w-full max-w-sm bg-background shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center p-4 h-20">
               <div className="flex items-center gap-2">
                 {/* ThemeToggle removed */}
               </div>
               <button onClick={() => setIsOpen(false)} className="text-foreground hover:text-primary transition-colors p-2">
                 <X className="w-7 h-7" />
               </button>
            </div>
            <div className="flex-grow px-6 pb-6 overflow-y-auto custom-scrollbar">
              <nav className="flex flex-col gap-1">
                {mainLinks.map(link => (
                  <NavLink key={link.path} to={link.path} icon={link.icon} onClick={() => setIsOpen(false)}>
                    {link.name}
                  </NavLink>
                ))}

                <div>
                  <button onClick={() => toggleSubmenu('help')} className="text-xl p-4 rounded-lg hover:bg-accent flex items-center justify-between w-full text-foreground gap-4">
                    <div className="flex items-center gap-4"><HelpCircle className="w-6 h-6"/>Ajuda</div>
                    <ChevronDown className={`w-5 h-5 transition-transform ${openSubmenu === 'help' ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {openSubmenu === 'help' && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-8">
                        <div className="pt-2 pb-2 space-y-1 border-l-2 border-border">
                          {helpLinks.map(s => <Link key={s.path} to={s.path} onClick={() => setIsOpen(false)} className="text-lg p-3 rounded-md hover:bg-accent flex items-center w-full text-foreground gap-3"><s.icon className={`w-5 h-5 ${s.color}`}/>{s.name}</Link>)}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </nav>
            </div>
            
            <div className="flex-shrink-0 p-6 border-t border-border">
              {session ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3">
                     <img src={user?.avatar_url || `https://api.dicebear.com/7.x/micah/svg?seed=${user?.username}`} alt="User avatar" className="w-12 h-12 rounded-full object-cover bg-secondary" />
                     <div>
                       <p className="font-semibold text-foreground truncate">{user?.full_name}</p>
                       <p className="text-sm text-muted-foreground">@{user?.username}</p>
                     </div>
                  </div>
                  <Button asChild variant="outline" className="w-full justify-start gap-4">
                    <Link to="/settings" onClick={() => setIsOpen(false)}>
                      <Settings />
                      Configurações
                    </Link>
                  </Button>
                  <Button variant="destructive" onClick={handleLogout} className="w-full justify-start gap-4"><LogOut/>Sair</Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <Link to="/login" className="w-full"><Button variant="outline" size="lg" className="w-full flex items-center gap-2"><LogIn/>Entrar</Button></Link>
                  <Link to="/register" className="w-full"><Button size="lg" className="w-full flex items-center gap-2"><UserPlus/>Cadastrar</Button></Link>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default Navbar;
