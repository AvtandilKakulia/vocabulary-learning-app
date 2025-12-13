 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/src/contexts/AuthContext.tsx b/src/contexts/AuthContext.tsx
index 0be809aa82c1a2274ba775ac2d03dfc43a83aede..ca20f9d14308da648b56871ed62501a28e5cf73c 100644
--- a/src/contexts/AuthContext.tsx
+++ b/src/contexts/AuthContext.tsx
@@ -1,65 +1,69 @@
 import React, { createContext, useContext, useEffect, useState } from 'react';
 import { supabase } from '../lib/supabase';
 import type { User } from '@supabase/supabase-js';
 
 interface AuthContextType {
   user: User | null;
   loading: boolean;
   signIn: (email: string, password: string) => Promise<void>;
   signUp: (email: string, password: string) => Promise<void>;
   signOut: () => Promise<void>;
   deleteAccount: () => Promise<void>;
   updateUserEmail: (email: string) => Promise<void>;
 }
 
 const AuthContext = createContext<AuthContextType | undefined>(undefined);
 
 export function AuthProvider({ children }: { children: React.ReactNode }) {
   const [user, setUser] = useState<User | null>(null);
   const [loading, setLoading] = useState(true);
 
   useEffect(() => {
-    // Load user on mount
+    // Load user on mount using local session (avoids network stalls)
     async function loadUser() {
       try {
-        const { data: { user } } = await supabase.auth.getUser();
-        setUser(user);
+        const { data, error } = await supabase.auth.getSession();
+        if (error) throw error;
+        setUser(data.session?.user ?? null);
+      } catch (error) {
+        console.error('Failed to load session', error);
+        setUser(null);
       } finally {
         setLoading(false);
       }
     }
+
     loadUser();
 
-    // Listen for auth changes (no async operations in callback)
-    const { data: { subscription } } = supabase.auth.onAuthStateChange(
-      (_event, session) => {
-        setUser(session?.user || null);
-      }
-    );
+    // Listen for auth changes and clear loading once we have a session update
+    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
+      setUser(session?.user ?? null);
+      setLoading(false);
+    });
 
-    return () => subscription.unsubscribe();
+    return () => data.subscription?.unsubscribe();
   }, []);
 
   const signIn = async (email: string, password: string) => {
     const { error } = await supabase.auth.signInWithPassword({ email, password });
     if (error) throw error;
   };
 
   const signUp = async (email: string, password: string) => {
     const { error } = await supabase.auth.signUp({ email, password });
     if (error) throw error;
   };
 
   const signOut = async () => {
     const { error } = await supabase.auth.signOut();
     if (error) throw error;
   };
 
   const deleteAccount = async () => {
     const { error } = await supabase.rpc('delete_user_account');
     if (error) throw error;
   };
 
   const updateUserEmail = async (email: string) => {
     const { error } = await supabase.auth.updateUser({ email });
     if (error) throw error;
 
EOF
)