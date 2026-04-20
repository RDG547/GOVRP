import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { isPrisonSentenceActive } from '@/lib/prison';
import { fetchExecutiveConstitutionalState } from '@/lib/executiveGovernance';
import {
  fetchElectionOfficeSyncState,
  resolveActiveElectionOfficeRolesForUser,
  syncElectionOffices,
} from '@/lib/electionOfficeSync';

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
]);

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
  const [triggerTutorial, setTriggerTutorial] = useState(false);

  const decorateProfileWithEffectiveRoles = useCallback(async (profile) => {
    if (!profile?.id) {
      return profile;
    }

    try {
      const [executiveState, electionOfficeState] = await Promise.all([
        fetchExecutiveConstitutionalState(supabase),
        fetchElectionOfficeSyncState(supabase).catch((error) => {
          console.error('Error fetching election office sync state:', error);
          return null;
        }),
      ]);
      const effectiveRoles = new Set([profile.role].filter(Boolean));
      const titleRoles = Array.isArray(profile?.titles)
        ? profile.titles.filter((title) => EFFECTIVE_ROLE_TITLES.has(title))
        : [];
      const grantedOfficeRoles = resolveActiveElectionOfficeRolesForUser(electionOfficeState, profile.id);
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

      return {
        ...profile,
        effective_roles: [...effectiveRoles],
        executive_ticket_role: executiveTicketRole,
        acting_executive_authority: Boolean(
          executiveState?.isVacant && executiveState?.actingAuthority?.profile?.id === profile.id
        ),
      };
    } catch (error) {
      console.error('Error resolving effective executive roles:', error);
      return {
        ...profile,
        effective_roles: [profile.role].filter(Boolean),
      };
    }
  }, []);

  const logout = useCallback(async () => {
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
        await syncElectionOffices().catch((error) => {
          console.error('Error syncing election offices before profile fetch:', error);
        });
        await supabase.rpc('check_and_update_prisoner_status');

        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', currentSession.user.id)
          .single();
        
        if (error?.code === 'PGRST116' || !profile) {
          const { error: creationError } = await supabase.rpc('ensure_profile_exists');
          if (creationError) {
            console.error("Failed to create profile, logging out.", creationError);
            await logout();
            return null;
          }
          const { data: newProfile, error: newProfileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentSession.user.id)
            .single();

          if (newProfileError || !newProfile) {
            console.error("Failed to fetch profile even after creation attempt, logging out.", newProfileError);
            await logout();
            return null;
          } else {
            return decorateProfileWithEffectiveRoles(newProfile);
          }
        } else if (error) {
          console.error("Error fetching profile, logging out.", error);
          await logout();
          return null;
        } else {
          return decorateProfileWithEffectiveRoles(profile);
        }
      } catch (e) {
        console.error("Exception fetching profile, logging out.", e);
        await logout();
        return null;
      }
    }
    return null;
  }, [decorateProfileWithEffectiveRoles, logout]);

  const refreshUser = useCallback(async ({ skipSync = false } = {}) => {
    if (session?.user?.id) {
      try {
        if (!skipSync) {
          await syncElectionOffices().catch((error) => {
            console.error('Error syncing election offices during refresh:', error);
          });
        }
        await supabase.rpc('check_and_update_prisoner_status');
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();
        if (profile && !error) {
            const decoratedProfile = await decorateProfileWithEffectiveRoles(profile);
            setUser(decoratedProfile);
        }
      } catch (error) {
        console.error('Error refreshing user profile:', error);
      }
    }
  }, [decorateProfileWithEffectiveRoles, session?.user?.id]);

  const syncOfficeStateForSessionUser = useCallback(async () => {
    if (!session?.user?.id) {
      return;
    }

    try {
      const result = await syncElectionOffices();
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
  }, [refreshUser, session?.user?.id]);

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
    if (!session?.user?.id) {
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
  }, [session?.user?.id, syncOfficeStateForSessionUser]);


  useEffect(() => {
    let isMounted = true;
    
    const getSession = async () => {
      try {
        const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
        
        if (!isMounted) return;

        if(sessionError && (sessionError.message === 'Invalid Refresh Token: Refresh Token Not Found' || sessionError.message === 'NetworkError when attempting to fetch resource.')) {
          await logout();
          return;
        }
        
        setSession(currentSession);
        const profile = await fetchUserProfile(currentSession);
        if (isMounted) setUser(profile);
      } catch (e) {
        console.error("Critical error during initial session load:", e);
        if (isMounted) {
          setUser(null);
          setSession(null);
        }
      } finally {
        if (isMounted) setLoading(false);
        if (safetyTimeout) clearTimeout(safetyTimeout);
      }
    };

    let safetyTimeout = setTimeout(() => {
      if (isMounted) {
        console.warn("Safety timeout triggered: forcing loading to false.");
        
        // If we timeout but have a session, ensure user isn't blindly null causing UI issues.
        // Try fallback to session metadata so TopNavbar and Dashboard don't crash.
        setSession((currentValidSession) => {
          if (currentValidSession?.user) {
            setUser((currentUserState) => {
              if (!currentUserState) {
                console.warn("Falling back to session metadata for user profile after timeout");
                return {
                  id: currentValidSession.user.id,
                  email: currentValidSession.user.email,
                  full_name: currentValidSession.user.user_metadata?.full_name || 'Usuário Desconectado',
                  username: currentValidSession.user.user_metadata?.username || 'user',
                  role: currentValidSession.user.app_metadata?.role || 'Cidadão',
                };
              }
              return currentUserState;
            });
          }
          return currentValidSession;
        });

        setLoading(false);
      }
    }, 10000);

    getSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        if (!isMounted) return;
        setSession(newSession);
        const profile = await fetchUserProfile(newSession);
        if (isMounted) {
          setUser(profile);
          setLoading(false);
        }
      }
    );

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
      authListener?.subscription.unsubscribe();
    };
  }, [fetchUserProfile, logout]);

  const login = async ({ identifier, password, captchaToken }) => {
    const normalizedIdentifier = identifier.trim();
    const normalizedPhone = normalizedIdentifier.replace(/\D/g, '');
    let email = normalizedIdentifier.toLowerCase();
    
    if (!email.includes('@')) {
      let profile = null;
      let error = null;

      if (normalizedPhone) {
        const response = await supabase
          .from('profiles')
          .select('email')
          .eq('phone', normalizedPhone)
          .maybeSingle();

        profile = response.data;
        error = response.error;
      }

      if (!profile) {
        const response = await supabase
          .from('profiles')
          .select('email')
          .eq('username', normalizedIdentifier)
          .maybeSingle();

        profile = response.data;
        error = response.error;
      }
        
      if (error || !profile) {
        throw new Error(AUTH_FAILURE_MESSAGE);
      }
      email = profile.email;
    }
    
    const { data, error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
    if (error) {
      throw new Error(AUTH_FAILURE_MESSAGE);
    }
    
    const profileData = await fetchUserProfile(data.session);
    setUser(profileData);
    
    return { ...data, user: profileData };
  };
  
  const register = async ({ email, password, captchaToken, ...meta }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        captchaToken,
        data: {
          full_name: meta.fullName,
          username: meta.username,
          phone: meta.phone,
          country_code: meta.countryCode,
          date_of_birth: meta.dateOfBirth,
          rg: meta.rg,
          cpf: meta.cpf,
        }
      }
    });
    if (error) throw error;
    
    return data;
  };

  const sendPasswordResetEmail = async (email) => {
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`
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
    refreshUser,
    triggerTutorial,
    setTriggerTutorial,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
