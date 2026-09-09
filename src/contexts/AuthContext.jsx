import { officialRoleCapabilities } from '@/lib/roleIcons';
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { isPrisonSentenceActive } from '@/lib/prison';
import { fetchExecutiveConstitutionalState } from '@/lib/executiveGovernance';
import {
  fetchElectionOfficeSyncState,
  resolveActiveElectionOfficeRolesForUser,
  syncElectionOffices,
} from '@/lib/electionOfficeSync';
import { isManualElectionRoleSuperseded } from '@/lib/roleResolution';
import { useDomainRealtime } from '@/hooks/use-domain-realtime';
import { getAppRedirectUrl } from '@/lib/nativeLinks';

const AuthContext = createContext();
const AUTH_FAILURE_MESSAGE = 'Credenciais inválidas. Verifique seus dados e tente novamente.';
const EFFECTIVE_ROLE_TITLES = new Set([
  'Presidente',
  'Vice-Presidente',
  'Deputado',
  'Senador',
  'Presidente da Câmara',
  'Presidente da Câmara dos Deputados',
  'Vice-Presidente da Câmara dos Deputados',
  'Presidente do Senado',
  'Vice-Presidente do Senado',
  'Vice-Presidente do Senado Federal',
  'Presidente do STF',
  'Presidente do Banco Nacional',
]);
const TERM_BOUND_OFFICE_ROLES = new Set(['Presidente', 'Vice-Presidente', 'Deputado', 'Senador']);
const AUTH_HYDRATION_TIMEOUT_MS = 15000;

const withTimeout = (promise, timeoutMs, message) => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser usado dentro de um AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [triggerTutorial, setTriggerTutorial] = useState(false);
  const hydrationRequestRef = useRef(0);
  const profileRefreshRef = useRef(0);
  const sessionRef = useRef(null);
  const userRef = useRef(null);
  const resumeRefreshRef = useRef(false);
  const lastResumeRefreshAtRef = useRef(0);

  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { userRef.current = user; }, [user]);

  const attachPrivateAccountIdentity = useCallback(async (profile, currentSession) => {
    if (!profile) return profile;

    const { data, error } = await supabase.rpc('get_my_account_identity');
    if (error) {
      console.error('Error fetching private account identity:', error);
    }

    const accountIdentity = Array.isArray(data) ? data[0] : data;
    return {
      ...profile,
      // These aliases only exist in the authenticated user's in-memory object.
      // They are never persisted in the public profiles table.
      account_identity: accountIdentity || null,
      real_full_name: accountIdentity?.real_full_name || null,
      real_date_of_birth: accountIdentity?.real_date_of_birth || null,
      phone: accountIdentity?.phone || null,
      email: currentSession?.user?.email || accountIdentity?.email || null,
    };
  }, []);

  const decorateProfileWithEffectiveRoles = useCallback(async (profile) => {
    if (!profile?.id) {
      return profile;
    }

    // A reset character cannot recover titles from a cached institutional state.
    if (profile.onboarding_completed === false) {
      return { ...profile, stored_role: profile.role, effective_roles: [profile.role === 'Admin' ? 'Admin' : 'Cidadão'] };
    }

    try {
      const [executiveState, electionOfficeState] = await Promise.all([
        fetchExecutiveConstitutionalState(supabase),
        fetchElectionOfficeSyncState(supabase).catch((error) => {
          console.error('Error fetching election office sync state:', error);
          return null;
        }),
      ]);
      const grantedOfficeRoles = resolveActiveElectionOfficeRolesForUser(electionOfficeState, profile.id);
      const grantedOfficeRoleSet = new Set(grantedOfficeRoles);
      const hasManualRoleOverride =
        profile.manual_role_override === true &&
        !isManualElectionRoleSuperseded(profile, electionOfficeState);
      const shouldExposeStoredRole =
        profile.role &&
        (!TERM_BOUND_OFFICE_ROLES.has(profile.role) ||
          grantedOfficeRoleSet.has(profile.role) ||
          hasManualRoleOverride);
      const displayRole = shouldExposeStoredRole ? profile.role : 'Cidadão';
      const effectiveRoles = new Set([displayRole].filter(Boolean));
      const titleRoles = Array.isArray(profile?.titles)
        ? profile.titles.filter((title) => {
            if (!EFFECTIVE_ROLE_TITLES.has(title)) {
              return false;
            }

            return !TERM_BOUND_OFFICE_ROLES.has(title) || grantedOfficeRoleSet.has(title);
          })
        : [];
      const filteredGrantedOfficeRoles = grantedOfficeRoles.filter((officeRole) => {
        if (officeRole === 'Presidente') {
          return executiveState?.currentPresidentProfile?.id === profile.id;
        }

        if (officeRole === 'Vice-Presidente') {
          return executiveState?.currentViceProfile?.id === profile.id;
        }

        return true;
      });
      let executiveTicketRole = null;

      titleRoles.forEach((roleTitle) => effectiveRoles.add(roleTitle));
      filteredGrantedOfficeRoles.forEach((officeRole) => effectiveRoles.add(officeRole));

      if (executiveState?.currentPresidentProfile?.id === profile.id) {
        effectiveRoles.add('Presidente');
        executiveTicketRole = 'Presidente';
      } else if (executiveState?.currentViceProfile?.id === profile.id) {
        effectiveRoles.add('Vice-Presidente');
        executiveTicketRole = 'Vice-Presidente';
      }

      if (executiveState?.isVacant && executiveState?.actingAuthority?.profile?.id === profile.id) {
        effectiveRoles.add('Presidente');
      }

      const bankPresidentAppointment = executiveState?.settings?.specialAppointmentsDetailed?.national_bank_president;
      const bankPresidentUserId =
        bankPresidentAppointment?.user_id ||
        bankPresidentAppointment?.userId ||
        bankPresidentAppointment?.profile?.id ||
        null;

      if (bankPresidentUserId === profile.id) {
        effectiveRoles.add('Presidente do Banco Nacional');
      }

      return {
        ...profile,
        stored_role: profile.role,
        role: displayRole,
        effective_roles: [...new Set([...effectiveRoles].flatMap(officialRoleCapabilities))],
        executive_ticket_role: executiveTicketRole,
        acting_executive_authority: Boolean(
          executiveState?.isVacant && executiveState?.actingAuthority?.profile?.id === profile.id
        ),
      };
    } catch (error) {
      console.error('Error resolving effective executive roles:', error);
      const fallbackRole =
        TERM_BOUND_OFFICE_ROLES.has(profile.role) && profile.manual_role_override !== true
          ? 'Cidadão'
          : profile.role;
      return {
        ...profile,
        stored_role: profile.role,
        role: fallbackRole,
        effective_roles: officialRoleCapabilities(fallbackRole).filter(Boolean),
      };
    }
  }, []);

  const logout = useCallback(async () => {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith('govrp:tutorial:')) sessionStorage.removeItem(key);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        if (error.message !== 'Invalid Refresh Token: Refresh Token Not Found') {
            console.error("Error logging out on server:", error.message);
        }
      }
    } catch (e) {
      console.error("Exception during logout:", e.message);
    } finally {
      setUser(null);
      setSession(null);
    }
  }, []);

  const fetchUserProfile = useCallback(async (currentSession) => {
    if (currentSession?.user) {
      try {
        await supabase.rpc('check_and_update_prisoner_status');

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', currentSession.user.id)
          .single();

        if (error?.code === 'PGRST116' || !profile) {
          const { error: creationError } = await supabase.rpc('ensure_profile_exists');
          if (creationError) {
            throw creationError;
          }
          const { data: newProfile, error: newProfileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentSession.user.id)
            .single();

          if (newProfileError || !newProfile) {
            throw newProfileError || new Error('Não foi possível preparar o perfil desta conta.');
          } else {
            const privateProfile = await attachPrivateAccountIdentity(newProfile, currentSession);
            return decorateProfileWithEffectiveRoles(privateProfile);
          }
        } else if (error) {
          throw error;
        } else {
          if (profile.role === 'Admin') {
            await syncElectionOffices({ accessToken: currentSession.access_token }).catch((syncError) => {
              console.error('Error syncing election offices for administrator:', syncError);
            });
          }
          const privateProfile = await attachPrivateAccountIdentity(profile, currentSession);
          return decorateProfileWithEffectiveRoles(privateProfile);
        }
      } catch (e) {
        console.error('Erro ao carregar o perfil autenticado:', e);
        throw e;
      }
    }
    return null;
  }, [attachPrivateAccountIdentity, decorateProfileWithEffectiveRoles]);

  const hydrateSession = useCallback(async (currentSession, { showLoading = true } = {}) => {
    const requestId = ++hydrationRequestRef.current;
    setSession(currentSession || null);
    sessionRef.current = currentSession || null;
    setAuthError('');

    if (!currentSession?.user) {
      setUser(null);
      userRef.current = null;
      setLoading(false);
      return null;
    }

    if (showLoading) setLoading(true);

    try {
      const profile = await withTimeout(
        fetchUserProfile(currentSession),
        AUTH_HYDRATION_TIMEOUT_MS,
        'O GOV.RP demorou para carregar sua conta. Verifique a conexão e tente novamente.'
      );

      if (requestId !== hydrationRequestRef.current) return profile;
      setUser(current => JSON.stringify(current) === JSON.stringify(profile) ? current : profile);
      userRef.current = profile;
      setLoading(false);
      return profile;
    } catch (error) {
      if (requestId !== hydrationRequestRef.current) return null;
      console.error('Falha na hidratação da sessão:', error);
      setUser(null);
      userRef.current = null;
      setAuthError(error?.message || 'Não foi possível carregar sua conta.');
      setLoading(false);
      return null;
    }
  }, [fetchUserProfile]);

  const refreshUser = useCallback(async ({ skipSync = false } = {}) => {
    const session = sessionRef.current;
    const user = userRef.current;
    const requestId = hydrationRequestRef.current;
    const refreshId = ++profileRefreshRef.current;
    if (session?.user?.id) {
      try {
        if (!skipSync && user?.role === 'Admin') {
          await syncElectionOffices({ accessToken: session.access_token }).catch((error) => {
            console.error('Error syncing election offices during refresh:', error);
          });
        }
        if (!skipSync && isPrisonSentenceActive(user)) await supabase.rpc('check_and_update_prisoner_status');
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();
        if (profile && !error) {
            const privateProfile = await attachPrivateAccountIdentity(profile, session);
            const decoratedProfile = await decorateProfileWithEffectiveRoles(privateProfile);
            if (sessionRef.current?.user?.id !== session.user.id || requestId !== hydrationRequestRef.current || refreshId !== profileRefreshRef.current) return;
            setUser(current => JSON.stringify(current) === JSON.stringify(decoratedProfile) ? current : decoratedProfile);
            userRef.current = decoratedProfile;
        }
      } catch (error) {
        console.error('Error refreshing user profile:', error);
      }
    }
  }, [attachPrivateAccountIdentity, decorateProfileWithEffectiveRoles]);

  const syncOfficeStateForSessionUser = useCallback(async () => {
    if (!session?.user?.id || user?.role !== 'Admin') {
      return;
    }

    try {
      const result = await syncElectionOffices({ accessToken: session.access_token });
      const changedUserIds = Array.isArray(result?.changedUserIds) ? result.changedUserIds : [];
      const grantedUserIds = Array.isArray(result?.grantedUserIds) ? result.grantedUserIds : [];

      if (
        changedUserIds.includes(session.user.id) ||
        grantedUserIds.includes(session.user.id)
      ) {
        await refreshUser({ skipSync: true });
      }
    } catch (error) {
      console.error('Error synchronizing election office state for the active session:', error);
    }
  }, [refreshUser, session?.access_token, session?.user?.id, user?.role]);

  useEffect(() => {
    if (!session?.user?.id || !isPrisonSentenceActive(user)) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      refreshUser();
    }, 60000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [refreshUser, session?.user?.id, user]);

  useEffect(() => {
    if (!session?.user?.id || user?.role !== 'Admin') {
      return undefined;
    }

    const initialTimeout = window.setTimeout(() => {
      syncOfficeStateForSessionUser();
    }, 1500);
    const intervalId = window.setInterval(() => {
      syncOfficeStateForSessionUser();
    }, 60000);

    return () => {
      window.clearTimeout(initialTimeout);
      window.clearInterval(intervalId);
    };
  }, [session?.user?.id, syncOfficeStateForSessionUser, user?.role]);


  const restoreSession = useCallback(async () => {
    setLoading(true);
    setAuthError('');

    try {
      const { data, error } = await withTimeout(
        supabase.auth.getSession(),
        AUTH_HYDRATION_TIMEOUT_MS,
        'A sessão demorou para responder. Verifique a conexão e tente novamente.'
      );

      if (error) throw error;
      await hydrateSession(data.session, { showLoading: true });
    } catch (error) {
      console.error('Erro ao restaurar sessão:', error);
      setUser(null);
      setSession(null);
      setAuthError(error?.message || 'Não foi possível restaurar sua sessão.');
      setLoading(false);
    }
  }, [hydrateSession]);

  const refreshSessionSilently = useCallback(async () => {
    const now = Date.now();
    if (resumeRefreshRef.current || now - lastResumeRefreshAtRef.current < 5000) return;
    resumeRefreshRef.current = true;
    lastResumeRefreshAtRef.current = now;

    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;

      let currentSession = data.session;
      if (!currentSession?.user) {
        sessionRef.current = null;
        userRef.current = null;
        setSession(null);
        setUser(null);
        return;
      }

      const expiresAt = Number(currentSession.expires_at || 0) * 1000;
      if (expiresAt && expiresAt - Date.now() < 120000) {
        const refreshed = await supabase.auth.refreshSession(currentSession);
        if (refreshed.error) throw refreshed.error;
        currentSession = refreshed.data.session || currentSession;
      }

      sessionRef.current = currentSession;
      setSession(currentSession);
      const profile = await fetchUserProfile(currentSession);
      if (sessionRef.current?.user?.id !== currentSession.user.id) return;
      if (profile) {
        userRef.current = profile;
        setUser(current => JSON.stringify(current) === JSON.stringify(profile) ? current : profile);
        setAuthError('');
      }
    } catch (error) {
      console.warn('Não foi possível atualizar a sessão silenciosamente:', error);
    } finally {
      resumeRefreshRef.current = false;
    }
  }, [fetchUserProfile]);

  useEffect(() => {
    let isMounted = true;

    const { data: authListener } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (!isMounted || event === 'INITIAL_SESSION') return;

      // Consultas Supabase dentro do callback assíncrono do Auth podem bloquear o
      // cliente. O callback apenas captura o evento; a hidratação roda no próximo turno.
      window.setTimeout(() => {
        if (!isMounted) return;
        if (event === 'SIGNED_OUT' || !newSession?.user) {
          void hydrateSession(null, { showLoading: false });
          return;
        }
        if (event === 'TOKEN_REFRESHED') {
          sessionRef.current = newSession;
          setSession(newSession);
          return;
        }
        const isSameUser = userRef.current?.id === newSession.user.id;
        if (event === 'SIGNED_IN' && isSameUser) {
          sessionRef.current = newSession;
          setSession(newSession);
          return;
        }
        void hydrateSession(newSession, { showLoading: event === 'SIGNED_IN' && !isSameUser });
      }, 0);
    });

    void restoreSession();

    return () => {
      isMounted = false;
      hydrationRequestRef.current += 1;
      authListener?.subscription.unsubscribe();
    };
  }, [hydrateSession, restoreSession]);

  useEffect(() => {
    const handleResume = () => { void refreshSessionSilently(); };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handleResume();
    };
    window.addEventListener('govrp:resume', handleResume);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('govrp:resume', handleResume);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [refreshSessionSilently]);

  useDomainRealtime('identity', session?.user?.id, [
    { table: 'profiles', event: 'UPDATE', filter: `id=eq.${session?.user?.id}` },
  ], () => { void refreshUser({ skipSync: true }); }, Boolean(session?.user?.id));

  const login = async ({ identifier, password, captchaToken }) => {
    const email = identifier.trim().toLowerCase();
    // O username pertence ao cidadão e é público. A conta OOC autentica apenas
    // pelo e-mail para que nenhuma RPC anônima precise revelar e-mails privados.
    if (!email.includes('@')) throw new Error('Entre com o e-mail privado da sua conta.');

    const { data, error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
    if (error) {
      throw new Error(AUTH_FAILURE_MESSAGE);
    }

    const profileData = await hydrateSession(data.session, { showLoading: true });

    if (!profileData) {
      throw new Error('A autenticação foi concluída, mas o perfil não pôde ser carregado. Tente novamente.');
    }

    return { ...data, user: profileData };
  };

  const register = async ({ email, password, captchaToken, ...meta }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        captchaToken,
        data: {
          real_full_name: meta.realFullName,
          phone: meta.phone,
          phone_country_code: meta.phoneCountryCode || '+55',
          real_date_of_birth: meta.realDateOfBirth,
        }
      }
    });
    if (error) {
      // Traduz erros comuns de constraint do Supabase para mensagens amigáveis
      const message = error.message || '';
      if (message.includes('username_length')) {
        throw new Error('O nome de usuário deve ter entre 3 e 20 caracteres e não pode conter caracteres especiais.');
      }
      if (message.includes('profiles_username_key') || message.toLowerCase().includes('username') && message.toLowerCase().includes('already')) {
        throw new Error('Este nome de usuário já está em uso. Escolha outro.');
      }
      if (message.includes('profiles_email_key') || message.includes('users_email_key') || (message.toLowerCase().includes('email') && message.toLowerCase().includes('already'))) {
        throw new Error('Este email já está cadastrado. Tente fazer login.');
      }
      // Erros de envio de email não devem bloquear o cadastro visualmente
      if (message.toLowerCase().includes('confirmation email') || message.toLowerCase().includes('sending confirmation')) {
        throw new Error('Cadastro criado, mas não foi possível enviar o email de confirmação. Verifique a configuração de SMTP do projeto ou desative a confirmação por email no dashboard do Supabase.');
      }
      throw error;
    }

    // Garante que o perfil foi criado corretamente após o signUp
    try {
      await supabase.rpc('ensure_profile_exists');
    } catch (profileError) {
      console.warn('ensure_profile_exists falhou após signUp:', profileError);
    }

    return data;
  };

  const sendPasswordResetEmail = async (email) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getAppRedirectUrl('/update-password')
    });
    if (error) throw error;
    return data;
  };

  const updatePassword = async (newPassword) => {
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw error;
    return data;
  };

  const value = {
    user,
    session,
    login,
    register,
    logout,
    sendPasswordResetEmail,
    updatePassword,
    loading,
    authError,
    retryAuth: restoreSession,
    refreshUser,
    triggerTutorial,
    setTriggerTutorial,
  };

  return (
    <AuthContext.Provider value={value}>
      {loading ? (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-white" role="status" aria-live="polite">
          <div className="text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-blue-400/30 border-t-blue-400" />
            <p className="mt-4 font-medium">Carregando sua sessão GOV.RP...</p>
            <p className="mt-1 text-sm text-slate-400">Estamos sincronizando sua conta e seu cidadão.</p>
          </div>
        </div>
      ) : authError ? (
        <div className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-white">
          <div className="w-full max-w-md rounded-2xl border border-red-400/20 bg-white/5 p-6 text-center shadow-2xl">
            <h1 className="text-xl font-semibold">Não foi possível carregar o GOV.RP</h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">{authError}</p>
            <button type="button" onClick={restoreSession} className="mt-6 rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-300">
              Tentar novamente
            </button>
          </div>
        </div>
      ) : children}
    </AuthContext.Provider>
  );
};
