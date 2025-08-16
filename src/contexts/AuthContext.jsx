import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

const AuthContext = createContext();

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
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();
        if (profile && !error) {
            setUser(profile);
        }
    }
  }, [session?.user?.id]);


  useEffect(() => {
    const getSession = async () => {
      const { data: { session: currentSession }, error: sessionError } = await supabase.auth.getSession();
      
      if(sessionError && sessionError.message === 'Invalid Refresh Token: Refresh Token Not Found') {
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

  const login = async ({ identifier, password }) => {
    let email = identifier;
    
    if (!identifier.includes('@')) {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('email')
        .or(`username.eq.${identifier},phone.eq.${identifier.replace(/\D/g, '')},email.eq.${identifier}`)
        .single();
        
      if (error || !profile) {
        throw new Error('Usuário não encontrado.');
      }
      email = profile.email;
    }
    
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    
    const profileData = await fetchUserProfile(data.session);
    setUser(profileData);
    
    return { ...data, user: profileData };
  };
  
  const register = async ({ email, password, ...meta }) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
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