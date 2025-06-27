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

  const logout = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("Error logging out on server:", error.message);
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
          // Profile doesn't exist, let's create it.
          const { error: creationError } = await supabase.rpc('ensure_profile_exists');
          if (creationError) {
            console.error("Failed to create profile, logging out.", creationError);
            await logout();
            return;
          }
          // Retry fetching after creation
          const { data: newProfile, error: newProfileError } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentSession.user.id)
            .single();

          if (newProfileError || !newProfile) {
            console.error("Failed to fetch profile even after creation attempt, logging out.", newProfileError);
            await logout();
          } else {
            setUser(newProfile);
          }
        } else if (error) {
          console.error("Error fetching profile, logging out.", error);
          await logout();
        } else {
          setUser(profile);
        }
      } catch (e) {
        console.error("Exception fetching profile, logging out.", e);
        await logout();
      }
    } else {
      setUser(null);
    }
  }, [logout]);

  useEffect(() => {
    const getSession = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      setSession(currentSession);
      await fetchUserProfile(currentSession);
      setLoading(false);
    };

    getSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (_event, newSession) => {
        setSession(newSession);
        await fetchUserProfile(newSession);
        setLoading(false);
      }
    );

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [fetchUserProfile]);

  const login = async ({ identifier, password }) => {
    let email = identifier;
    
    if (!identifier.includes('@')) {
      const { data: profile, error } = await supabase
        .from('profiles')
        .select('email')
        .or(`username.eq.${identifier},phone.eq.${identifier.replace(/\D/g, '')}`)
        .single();

      if (error || !profile) {
        throw new Error('Usuário não encontrado.');
      }
      email = profile.email;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
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
    refreshUser: () => fetchUserProfile(session),
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};