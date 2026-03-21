import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { isPrisonSentenceActive } from '@/lib/prison';

const AuthContext = createContext();
const AUTH_FAILURE_MESSAGE = 'Credenciais inválidas. Verifique seus dados e tente novamente.';

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
            return newProfile;
          }
        } else if (error) {
          console.error("Error fetching profile, logging out.", error);
          await logout();
          return null;
        } else {
          return profile;
        }
      } catch (e) {
        console.error("Exception fetching profile, logging out.", e);
        await logout();
        return null;
      }
    }
    return null;
  }, [logout]);

  const refreshUser = useCallback(async () => {
    if (session?.user?.id) {
      try {
        await supabase.rpc('check_and_update_prisoner_status');
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();
        if (profile && !error) {
            setUser(profile);
        }
      } catch (error) {
        console.error('Error refreshing user profile:', error);
      }
    }
  }, [session?.user?.id]);

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
    const getSession = async () => {
      const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
      
      if(sessionError && (sessionError.message === 'Invalid Refresh Token: Refresh Token Not Found' || sessionError.message === 'NetworkError when attempting to fetch resource.')) {
        await logout();
        setLoading(false);
        return;
      }
      
      setSession(currentSession);
      const profile = await fetchUserProfile(currentSession);
      setUser(profile);
      setLoading(false);
    };

    getSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        const profile = await fetchUserProfile(newSession);
        setUser(profile);
        setLoading(false);
      }
    );

    return () => {
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
