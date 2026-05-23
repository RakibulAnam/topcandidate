import React, { useState, useEffect, useRef } from 'react';

interface EditableProps {
    value: string;
    onSave: (value: string) => void;
    className?: string;
    style?: React.CSSProperties;
    as?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span' | 'div';
    multiline?: boolean;
    placeholder?: string;
    readOnly?: boolean;
}

export const EditableElement: React.FC<EditableProps> = ({
    value,
    onSave,
    className = '',
    style,
    as: Tag = 'span',
    multiline = false,
    placeholder,
    readOnly = false
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [localValue, setLocalValue] = useState(value);
    const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
        }
    }, [isEditing]);

    const handleBlur = () => {
        setIsEditing(false);
        if (localValue !== value) {
            onSave(localValue);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey && !multiline) {
            e.preventDefault();
            handleBlur();
        }
    };

    if (isEditing) {
        if (multiline) {
            return (
                <textarea
                    ref={inputRef as React.RefObject<HTMLTextAreaElement>}
                    value={localValue}
                    onChange={(e) => setLocalValue(e.target.value)}
                    onBlur={handleBlur}
                    onKeyDown={handleKeyDown}
                    className={`w-full bg-transparent outline-none border-b border-brand-300 ${className} resize-none overflow-hidden`}
                    style={{ ...style, height: 'auto', minHeight: '1.5em' }}
                    onInput={(e) => {
                        const target = e.target as HTMLTextAreaElement;
                        target.style.height = 'auto';
                        target.style.height = target.scrollHeight + 'px';
                    }}
                />
            );
        }
        return (
            <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                value={localValue}
                onChange={(e) => setLocalValue(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                className={`w-full bg-transparent outline-none border-b border-brand-300 ${className}`}
                style={style}
            />
        );
    }

    if (readOnly) {
        return (
            <Tag
                className={`${className} ${!value && placeholder ? 'text-charcoal-400 italic' : ''}`}
                style={style}
            >
                {value || placeholder}
            </Tag>
        );
    }

    return (
        <Tag
            onClick={() => setIsEditing(true)}
            className={`cursor-text hover:bg-charcoal-50 hover:ring-1 hover:ring-charcoal-200 rounded px-0.5 -mx-0.5 transition-shadow ${!value && placeholder ? 'text-charcoal-400 italic' : ''} ${className}`}
            style={style}
            title="Click to edit"
        >
            {value || placeholder}
        </Tag>
    );
};
