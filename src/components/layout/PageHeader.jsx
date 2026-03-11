import React from 'react';
import { motion } from 'framer-motion';

const PageHeader = ({ icon: Icon, title, description, gradientText, iconColor = 'text-blue-400', children, centered = false }) => {
  const alignmentClass = centered ? 'text-center' : 'text-center md:text-left';
  const containerClass = centered ? 'flex flex-col justify-center items-center gap-4' : 'md:flex md:justify-between md:items-center md:gap-8';

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="mb-12 md:mb-16"
    >
      <div className={containerClass}>
        <div className={`flex-grow ${alignmentClass}`}>
          {Icon && (
            <div className={`inline-block p-4 rounded-full mb-4 bg-white/10`}>
              <Icon className={`w-10 h-10 ${iconColor}`} />
            </div>
          )}
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-white mb-4">
            {title} {gradientText && <span className="gradient-text">{gradientText}</span>}
          </h1>
          {description && (
            <p className="mt-6 max-w-3xl text-lg text-muted-foreground mx-auto text-center leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {children && <div className="flex-shrink-0 mt-4 md:mt-0">{children}</div>}
      </div>
    </motion.div>
  );
};

export default PageHeader;