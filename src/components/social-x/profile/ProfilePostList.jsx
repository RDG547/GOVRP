import React, { useRef } from 'react';
import PostCard from '@/components/social-x/PostCard';
import { motion, AnimatePresence } from 'framer-motion';

const ProfilePostList = ({ posts, currentUser, onInteraction, onDelete }) => {
    const viewedPosts = useRef(new Set());

    return (
        <div className="mt-8 space-y-4">
            <h2 className="text-2xl font-bold text-white">Posts</h2>
            {posts.length > 0 ? (
                <AnimatePresence>
                    {posts.map(post => (
                        <motion.div key={post.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                            <PostCard
                                post={post}
                                currentUser={currentUser}
                                onInteraction={onInteraction}
                                viewedPosts={viewedPosts}
                                onDelete={onDelete}
                            />
                        </motion.div>
                    ))}
                </AnimatePresence>
            ) : (
                <div className="text-center py-16 text-gray-400 glass-effect rounded-2xl">
                    <p>Este usuário ainda não fez nenhuma publicação.</p>
                </div>
            )}
        </div>
    );
};

export default ProfilePostList;