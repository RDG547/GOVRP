import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ChevronDown, Settings, LayoutDashboard, Landmark, Briefcase, FileText, Library, Archive, MessageSquare, Users, Newspaper, Home as HomeIcon, Heart, HelpCircle, Headphones as Headset, Grid, Mail, BookOpen, LogOut, Scale, Gavel, Shield, Vote, Eye, ShieldCheck, Crown } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { useToast } from './ui/use-toast';
import NotificationBell from './NotificationBell';
import ThemeToggle from './ThemeToggle';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const Navbar = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [isDashboardAlertOpen, setIsDashboardAlertOpen] = useState(false);
  
  const { user, logout, session } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

  const servicesTimeoutRef = useRef(null);
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
  }, [location]);

  const services = [
    { name: 'Banco Nacional', path: '/services/bank', icon: <Landmark className="w-5 h-5 text-green-400"/> },
    { name: 'Negócios Livres', path: '/services/business', icon: <Briefcase className="w-5 h-5 text-blue-400"/> },
    { name: 'DIC', path: '/services/dic', icon: <FileText className="w-5 h-5 text-purple-400"/> },
    { name: 'X', path: '/services/x', icon: <MessageSquare className="w-5 h-5 text-sky-400"/> },
    { name: 'Portal Eleitoral Nacional', path: '/services/elections', icon: <Vote className="w-5 h-5 text-teal-400"/> },
    { name: 'Partidos Políticos', path: '/services/political-parties', icon: <Users className="w-5 h-5 text-red-400"/> },
    { name: 'Parlamento', path: '/services/parliament', icon: <Scale className="w-5 h-5 text-yellow-400"/> },
  ];

  const navLinks = [
      { name: 'Início', path: '/', icon: HomeIcon },
      { name: 'Serviços', path: '/services', icon: LayoutDashboard, isDropdown: true },
      { name: 'Notícias', path: '/news', icon: Newspaper },
      { name: 'Comunidade', path: '/community', icon: Users },
      { name: 'Suporte', path: '/support', icon: Headset },
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

  const handleDashboardClick = (e) => {
    e.preventDefault();
    if (user?.role === 'Admin') {
      setIsDashboardAlertOpen(true);
    } else {
      navigate('/dashboard');
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
      <motion.nav ref={navRef} initial={{ y: -100 }} animate={{ y: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }} className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${isScrolled || isOpen ? 'bg-background/80 backdrop-blur-xl border-b border-border' : 'bg-transparent'}`}>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            <Link to="/" className="flex items-center space-x-2"><motion.div whileHover={{ scale: 1.1, rotate: -5 }} className="text-3xl font-bold text-foreground">GOV.RP</motion.div></Link>

            <div className="hidden md:flex items-center space-x-6">
              {navLinks.map(link => (
                link.isDropdown ? (
                  <div key={link.name} className="relative" onMouseEnter={handleServicesEnter} onMouseLeave={handleServicesLeave}>
                    <button onClick={handleServicesClick} className="flex items-center gap-2 text-foreground hover:text-primary transition-colors cursor-pointer font-medium"><LayoutDashboard className="w-4 h-4" /><span>{link.name}</span><ChevronDown className={`w-4 h-4 transition-transform ${servicesOpen ? 'rotate-180' : ''}`} /></button>
                    <AnimatePresence>
                      {servicesOpen && (
                        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} className="absolute top-full left-1/2 -translate-x-1/2 mt-4 w-72 bg-popover/80 backdrop-blur-lg border border-border rounded-lg shadow-2xl p-2">
                          {services.map((s) => (<Link key={s.path} to={s.path} className="flex items-center space-x-3 px-4 py-3 hover:bg-accent transition-colors rounded-md text-popover-foreground"><div className="flex-shrink-0">{s.icon}</div><span>{s.name}</span></Link>))}
                          <div className="border-t border-border my-1"></div>
                          <Link to="/services" className="flex items-center justify-center space-x-3 px-4 py-3 hover:bg-accent transition-colors rounded-md text-primary font-semibold"><Grid className="w-5 h-5"/><span>Ver Todos</span></Link>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <NavLink key={link.path} to={link.path} icon={link.icon}>{link.name}</NavLink>
                )
              ))}
            </div>

            <div className="hidden md:flex items-center space-x-2">
              <ThemeToggle />
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
                      {user?.role === 'Admin' && (
                        <DropdownMenuItem asChild>
                          <Link to="/admin-dashboard" className="flex items-center w-full cursor-pointer"><Crown className="w-4 h-4 mr-2 text-yellow-400" /><span>Admin</span></Link>
                        </DropdownMenuItem>
                      )}
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
                  <Link to="/login"><Button variant="ghost" className="text-foreground hover:bg-accent hover:text-accent-foreground">Entrar</Button></Link>
                  <Link to="/register"><Button className="bg-primary text-primary-foreground hover:bg-primary/90">Cadastrar</Button></Link>
                </>
              )}
            </div>
            
            <button onClick={() => setIsOpen(!isOpen)} className="md:hidden text-foreground hover:text-primary transition-colors z-[101] relative">{isOpen ? <X className="w-7 h-7" /> : <Menu className="w-7 h-7" />}</button>
          </div>
        </div>
      </motion.nav>
      <MobileMenu isOpen={isOpen} setIsOpen={setIsOpen} />
      <AlertDialog open={isDashboardAlertOpen} onOpenChange={setIsDashboardAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Qual dashboard você deseja acessar?</AlertDialogTitle>
            <AlertDialogDescription>
              Como administrador, você pode escolher entre a visão de cidadão ou o painel de controle administrativo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-center gap-2">
            <AlertDialogAction asChild>
              <Link to="/dashboard" className="w-full sm:w-auto"><Button className="w-full">Dashboard do Cidadão</Button></Link>
            </AlertDialogAction>
            <AlertDialogAction asChild>
              <Link to="/admin-dashboard" className="w-full sm:w-auto"><Button variant="secondary" className="w-full">Dashboard do Admin</Button></Link>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

const MobileMenu = ({ isOpen, setIsOpen }) => {
  const { user, logout, session } = useAuth();
  const [mobileServicesOpen, setMobileServicesOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = async () => {
    setIsOpen(false);
    await logout();
    navigate('/');
  };

  const services = [
    { name: 'Banco Nacional', path: '/services/bank', icon: <Landmark className="w-5 h-5 text-green-400"/> },
    { name: 'Negócios Livres', path: '/services/business', icon: <Briefcase className="w-5 h-5 text-blue-400"/> },
    { name: 'DIC', path: '/services/dic', icon: <FileText className="w-5 h-5 text-purple-400"/> },
    { name: 'X', path: '/services/x', icon: <MessageSquare className="w-5 h-5 text-sky-400"/> },
    { name: 'Portal Eleitoral Nacional', path: '/services/elections', icon: <Vote className="w-5 h-5 text-teal-400"/> },
    { name: 'Partidos Políticos', path: '/services/political-parties', icon: <Users className="w-5 h-5 text-red-400"/> },
    { name: 'Parlamento', path: '/services/parliament', icon: <Scale className="w-5 h-5 text-yellow-400"/> },
  ];

  const mainLinks = [
    { name: 'Início', path: '/', icon: HomeIcon },
    { name: 'Notícias', path: '/news', icon: Newspaper },
    { name: 'Comunidade', path: '/community', icon: Users },
    { name: 'Sobre Nós', path: '/about', icon: BookOpen },
    { name: 'Apoie o Projeto', path: '/support-us', icon: Heart },
  ];
  const supportLinks = [
    { name: 'Suporte', path: '/support', icon: Headset },
    { name: 'Contato', path: '/contact', icon: Mail },
    { name: 'Documentação', path: '/docs', icon: BookOpen },
    { name: 'FAQ', path: '/faq', icon: HelpCircle },
  ];
  
  const NavLink = ({ to, children, icon: Icon, onClick }) => (
    <Link to={to} onClick={onClick} className="text-xl p-4 rounded-lg hover:bg-accent flex items-center w-full text-foreground gap-4">
      <Icon className="w-6 h-6"/>
      {children}
    </Link>
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="md:hidden fixed inset-0 z-[100] bg-background/80 backdrop-blur-lg"
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
            <div className="flex justify-between items-center p-4">
               <ThemeToggle />
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
                  <button onClick={() => setMobileServicesOpen(p => !p)} className="text-xl p-4 rounded-lg hover:bg-accent flex items-center justify-between w-full text-foreground gap-4">
                    <div className="flex items-center gap-4"><LayoutDashboard className="w-6 h-6"/>Serviços</div>
                    <ChevronDown className={`w-5 h-5 transition-transform ${mobileServicesOpen ? 'rotate-180' : ''}`} />
                  </button>
                  <AnimatePresence>
                    {mobileServicesOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden pl-8">
                        <div className="pt-2 pb-2 space-y-1 border-l-2 border-border">
                          {services.map(s => <Link key={s.path} to={s.path} onClick={() => setIsOpen(false)} className="text-lg p-3 rounded-md hover:bg-accent flex items-center w-full text-foreground gap-3"><div className="flex-shrink-0">{s.icon}</div>{s.name}</Link>)}
                          <div className="border-t border-border my-2 mx-3"></div>
                          <Link to="/services" onClick={() => setIsOpen(false)} className="text-lg p-3 rounded-md hover:bg-accent flex items-center w-full font-semibold text-primary gap-3"><Grid className="w-5 h-5"/>Ver Todos</Link>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </nav>

              <div className="mt-6 pt-6 border-t border-border">
                <span className="px-4 text-sm font-semibold text-muted-foreground uppercase">Ajuda & Informações</span>
                <div className="mt-2 space-y-1">
                  {supportLinks.map(link => (
                      <NavLink key={link.path} to={link.path} icon={link.icon} onClick={() => setIsOpen(false)}>
                        {link.name}
                      </NavLink>
                  ))}
                </div>
              </div>
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
                  <Link to="/dashboard" onClick={() => setIsOpen(false)} className="w-full"><Button variant="outline" className="w-full justify-start gap-4"><LayoutDashboard/>Dashboard</Button></Link>
                  <Button variant="destructive" onClick={handleLogout} className="w-full justify-start gap-4"><LogOut/>Sair</Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <Link to="/login" className="w-full"><Button variant="outline" size="lg" className="w-full">Entrar</Button></Link>
                  <Link to="/register" className="w-full"><Button size="lg" className="w-full">Cadastrar</Button></Link>
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