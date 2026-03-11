import React, { useState, useRef } from 'react';
    import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
    import { Helmet } from 'react-helmet-async';
    import XSidebar from '@/components/social-x/XSidebar';
    import TrendsSidebar from '@/components/social-x/TrendsSidebar';
    import XOnboarding from '@/components/social-x/XOnboarding';
    import { useAuth } from '@/contexts/AuthContext';
    import CreatePostForm from '@/components/social-x/CreatePostForm';
    import { Dialog, DialogContent } from '@/components/ui/dialog';
    import XHeader from '@/components/social-x/XHeader';
    import Navbar from '@/components/layout/Navbar';
    import Footer from '@/components/layout/Footer';
    import XFeed from '@/components/social-x/XFeed';
    import XProfile from '@/pages/services/x/Profile';
    import XNotifications from '@/pages/services/x/Notifications';
    import XMessages from '@/pages/services/x/Messages';
    import XSearch from '@/pages/services/x/Search';
    import PostDetails from '@/pages/services/x/PostDetails';

    const SocialX = () => {
        const { user, refreshUser } = useAuth();
        const [isPostModalOpen, setIsPostModalOpen] = useState(false);
        const postInputRef = useRef(null);

        if (!user?.x_handle) {
            return (
                <>
                    <Navbar />
                    <main className="pt-20">
                        <XOnboarding onProfileCreated={refreshUser} />
                    </main>
                    <Footer />
                </>
            );
        }

        return (
            <>
                <Helmet>
                    <title>X - GOV.RP</title>
                    <meta name="description" content="Conecte-se, compartilhe e debata na rede social do GOV.RP." />
                </Helmet>
                <div className="min-h-screen bg-background text-foreground">
                    <Navbar />
                    <main className="pt-20 w-full">
                        <div className="flex justify-center w-full">
                            <div className="w-full max-w-screen-xl grid grid-cols-1 md:grid-cols-[auto,minmax(0,600px)] lg:grid-cols-[auto,minmax(0,600px),1fr]">
                                <header className="hidden md:sticky top-20 h-[calc(100vh-5rem)] md:flex md:flex-col md:justify-between md:w-20 xl:w-64">
                                    <XSidebar onPostClick={() => setIsPostModalOpen(true)} />
                                </header>
                                
                                <div className="border-x border-border min-h-screen pb-16 md:pb-0">
                                    <div className="md:hidden sticky top-20 bg-background/80 backdrop-blur-sm z-30">
                                        <XHeader />
                                    </div>
                                    <Outlet context={{ postInputRef }} />
                                </div>

                                <aside className="hidden lg:block w-full max-w-[350px] p-4">
                                    <div className="sticky top-20">
                                        <TrendsSidebar />
                                    </div>
                                </aside>
                            </div>
                        </div>
                    </main>
                </div>
                <div className="md:hidden fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50">
                    <XSidebar onPostClick={() => setIsPostModalOpen(true)} />
                </div>
                <Dialog open={isPostModalOpen} onOpenChange={setIsPostModalOpen}>
                    <DialogContent>
                        <CreatePostForm ref={postInputRef} onPostCreated={() => setIsPostModalOpen(false)} />
                    </DialogContent>
                </Dialog>
            </>
        );
    };

    export default SocialX;