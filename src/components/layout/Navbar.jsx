import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ChevronDown, Settings, LayoutDashboard, Tally5, Landmark, Store, FileText, Library, Archive, MessageSquare, Users, Newspaper, Home as HomeIcon, Heart, HelpCircle, Headphones as Headset, Grid, Mail, BookOpen, LogOut, Scale, Gavel, Shield, Vote, Eye, ShieldCheck, Crown, HeartHandshake as Handcuffs, Map, Siren, Wifi, Zap, Droplet, Smartphone, Wrench, Milestone, LogIn, UserPlus, FolderKanban, User, Flame } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import NotificationBell from '@/components/NotificationBell';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const serviceCategories = [
  {
    name: 'Governo e Cidadania',
    services: [
      { name: 'Banco Nacional', path: '/services/bank', icon: Landmark, color: "text-green-400" },
      { name: 'DIC', path: '/services/dic', icon: FileText, color: "text-purple-400" },
      { name: 'Portal Eleitoral', path: '/services/elections', icon: Vote, color: "text-teal-400" },
      { name: 'Partidos Políticos', path: '/services/political-parties', icon: Users, color: "text-red-400" },
      { name: 'Parlamento', path: '/services/parliament', icon: Scale, color: "text-yellow-400" },
      { name: 'Portal de Notícias', path: '/news', icon: Newspaper, color: "text-cyan-400" },
    ]
  },
  {
    name: 'Segurança e Justiça',
    services: [
      { name: 'Polícia', path: '/services/police', icon: Siren, color: "text-blue-500" },
      { name: 'Sistema Penal', path: '/services/penal-system', icon: Gavel, color: "text-amber-400" },
      { name: 'Prisão', path: '/services/prison', icon: Tally5, color: "text-slate-400" },
      { name: 'Forças Armadas', path: '/services/armed-forces', icon: ShieldCheck, color: "text-emerald-500" },
      { name: 'Agência de Inteligência', path: '/services/agies', icon: Eye, color: "text-red-500" },
    ]
  },
  {
    name: 'Comunidade e Cultura',
    services: [
      { name: 'X', path: '/services/x', icon: MessageSquare, color: "text-sky-400" },
      { name: 'Negócios Livres', path: '/services/business', icon: Store, color: "text-blue-400" },
      { name: 'Biblioteca Nacional', path: '/services/library', icon: Library, color: "text-orange-400" },
      { name: 'Acervo Digital', path: '/services/digital-archive', icon: Archive, color: "text-rose-400" },
    ]
  },
   {
    name: 'Serviços Básicos',
    services: [
      { name: 'Internet', path: '/services/internet', icon: Wifi, color: "text-cyan-400" },
      { name: 'Energia Elétrica', path: '/services/electricity', icon: Zap, color: "text-yellow-400" },
      { name: 'Água', path: '/services/water', icon: Droplet, color: "text-blue-400" },
      { name: 'Telefonia', path: '/services/phone', icon: Smartphone, color: "text-violet-400" },
      { name: 'Aluguel', path: '/services/rent', icon: HomeIcon, color: "text-orange-400" },
      { name: 'Manutenção', path: '/services/maintenance', icon: Wrench, color: "text-gray-400" },
      { name: 'Gás', path: '/services/gas', icon: Flame, color: "text-orange-500" },
    ]
  }
];

const helpLinks = [
    { name: 'Contato', path: '/contact', icon: Mail, color: "text-orange-400" },
    { name: 'Suporte', path: '/support', icon: Headset, color: "text-blue-400" },
    { name: 'FAQ', path: '/faq', icon: HelpCircle, color: "text-yellow-400" },
    { name: 'Docs', path: '/docs', icon: BookOpen, color: "text-green-400" },
    { name: 'Roadmap', path: '/roadmap', icon: Milestone, color: "text-purple-400" },
];

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [isDashboardAlertOpen, setIsDashboardAlertOpen] = useState(false);
  
  const { user, logout, session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

  const servicesTimeoutRef = useRef(null);
  const helpTimeoutRef = useRef(null);
  const navRef = useRef(null);

  useEffect(() => {
    const handleScroll = () => setIsScrolled(window.scrollY > 10);
    window.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);
  
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (navRef.current && !navRef.current.contains(event.target)) {
        setServicesOpen(false);
        setHelpOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [navRef]);

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
  }, [location]);

  const navLinks = [
      { name: 'Início', path: '/', icon: HomeIcon },
      { name: 'Serviços', path: '/services', icon: LayoutDashboard, isDropdown: true, type: 'services' },
      { name: 'Sobre o País', path: '/country-info', icon: Map },
      { name: 'Comunidade', path: '/community', icon: Users },
      { name: 'Ajuda', path: '#', icon: HelpCircle, isDropdown: true, type: 'help' },
      { name: 'Sobre Nós', path: '/about', icon: BookOpen },
  ];
  
  const handleLogout = async () => {
    await logout();
    toast({ title: 'Você saiu da sua conta.' });
    navigate('/');
  };
  
  const handleServicesEnter = () => { clearTimeout(servicesTimeoutRef.current); setServicesOpen(true); };
  const handleServicesLeave = () => { servicesTimeoutRef.current = setTimeout(() => setServicesOpen(false), 200); };
  const handleServicesClick = (e) => { e.preventDefault(); setServicesOpen(prev => !prev); };

  const handleHelpEnter = () => { clearTimeout(helpTimeoutRef.current); setHelpOpen(true); };
  const handleHelpLeave = () => { helpTimeoutRef.current = setTimeout(() => setHelpOpen(false), 200); };
  const handleHelpClick = (e) => { e.preventDefault(); setHelpOpen(prev => !prev); };

  const handleDashboardClick = (e) => {
    e.preventDefault();
    if (user?.role === 'Admin' || user?.role === 'Presidente') {
      setIsDashboardAlertOpen(true);
    } else {
      navigate('/dashboard/citizen');
    }
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
                            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute top-full left-1/2 -translate-x-1/2 mt-4 grid grid-cols-2 gap-1 w-[28rem] bg-popover border border-border rounded-lg shadow-2xl p-2">
                               {serviceCategories.map((category) => (
                                 <div key={category.name} className="p-2">
                                   <h3 className="font-semibold text-sm text-muted-foreground px-2 mb-2">{category.name}</h3>
                                    {category.services.map((service) => (
                                      <Link key={service.path} to={service.path} className="flex items-center space-x-3 px-2 py-2 text-sm hover:bg-accent transition-colors rounded-md text-popover-foreground">
                                        <service.icon className={`w-4 h-4 ${service.color}`}/><span>{service.name}</span>
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
              <button onClick={() => setIsOpen(!isOpen)} className="text-foreground hover:text-primary transition-colors z-[101] relative ml-2">{isOpen ? <X className="w-7 h-7" /> : <Menu className="w-7 h-7" />}</button>
            </div>
          </div>
        </div>
      </motion.nav>
      <MobileMenu isOpen={isOpen} setIsOpen={setIsOpen} />
      <AlertDialog open={isDashboardAlertOpen} onOpenChange={setIsDashboardAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader className="text-center">
            <AlertDialogTitle>Qual dashboard você deseja acessar?</AlertDialogTitle>
            <AlertDialogDescription>
              Seu cargo permite acesso a múltiplos painéis. Por favor, escolha um.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2">
            <Link to="/dashboard/citizen" className="w-full" onClick={() => setIsDashboardAlertOpen(false)}>
              <Button className="w-full justify-center gap-3 bg-blue-600 hover:bg-blue-700">
                <User className="w-5 h-5" />
                <span>Dashboard do Cidadão</span>
              </Button>
            </Link>
            {(user?.role === 'Presidente' || user?.role === 'Admin') && (
              <Link to="/dashboard/president" className="w-full" onClick={() => setIsDashboardAlertOpen(false)}>
                <Button variant="secondary" className="w-full justify-center gap-3 bg-yellow-500 hover:bg-yellow-600 text-black">
                  <FolderKanban className="w-5 h-5" />
                  <span>Painel Presidencial</span>
                </Button>
              </Link>
            )}
            {user?.role === 'Admin' && (
              <Link to="/admin-dashboard" className="w-full" onClick={() => setIsDashboardAlertOpen(false)}>
                <Button variant="secondary" className="w-full justify-center gap-3 bg-slate-700 hover:bg-slate-800 text-white">
                  <Crown className="w-5 h-5" />
                  <span>Dashboard do Admin</span>
                </Button>
              </Link>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
    { name: 'Início', path: '/', icon: HomeIcon },
    { name: 'Sobre o País', path: '/country-info', icon: Map },
    { name: 'Comunidade', path: '/community', icon: Users },
    { name: 'Sobre Nós', path: '/about', icon: BookOpen },
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

  const handleDashboardClick = () => {
    setIsOpen(false);
    navigate('/dashboard');
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
                  <button onClick={() => toggleSubmenu('services')} className="text-xl p-4 rounded-lg hover:bg-accent flex items-center justify-between w-full text-foreground gap-4">
                    <div className="flex items-center gap-4"><LayoutDashboard className="w-6 h-6"/>Serviços</div>
                    <ChevronDown className={`w-5 h-5 transition-transform ${openSubmenu === 'services' ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {openSubmenu === 'services' && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-8">
                        <div className="pt-2 pb-2 space-y-1 border-l-2 border-border">
                          {serviceCategories.map(category => (
                            <div key={category.name} className="py-2">
                              <h3 className="font-semibold text-sm text-muted-foreground px-3 mb-2">{category.name}</h3>
                              {category.services.map(s => <Link key={s.path} to={s.path} onClick={() => setIsOpen(false)} className="text-lg p-3 rounded-md hover:bg-accent flex items-center w-full text-foreground gap-3"><s.icon className={`w-5 h-5 ${s.color}`}/>{s.name}</Link>)}
                            </div>
                          ))}
                          <div className="border-t border-border my-2 mx-3"></div>
                          <Link to="/services" onClick={() => setIsOpen(false)} className="text-lg p-3 rounded-md hover:bg-accent flex items-center w-full font-semibold text-primary gap-3"><Grid className="w-5 h-5"/>Ver Todos</Link>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                
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
                  <Button variant="outline" onClick={handleDashboardClick} className="w-full justify-start gap-4"><LayoutDashboard/>Dashboard</Button>
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