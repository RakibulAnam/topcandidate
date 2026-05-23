import * as React from "react";
import { format, parse, isValid } from "date-fns";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "./utils";
import { Button } from "./button";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "./popover";

interface MonthPickerProps {
    value?: string; // YYYY-MM
    onChange?: (value: string) => void;
    isError?: boolean;
}

export function MonthPicker({ value, onChange, isError }: MonthPickerProps) {
    // Parse incoming YYYY-MM
    const parsedDate = React.useMemo(() => {
        if (!value) return null;
        const d = parse(value, "yyyy-MM", new Date());
        return isValid(d) ? d : null;
    }, [value]);

    const [isOpen, setIsOpen] = React.useState(false);

    // View state: looking at months of a specific year
    const [viewYear, setViewYear] = React.useState<number>(
        parsedDate ? parsedDate.getFullYear() : new Date().getFullYear()
    );

    const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];

    const handleMonthSelect = (monthIndex: number) => {
        const formatted = `${viewYear}-${String(monthIndex + 1).padStart(2, "0")}`;
        onChange?.(formatted);
        setIsOpen(false);
    };

    const handlePrevYear = () => setViewYear(y => y - 1);
    const handleNextYear = () => setViewYear(y => y + 1);

    return (
        <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    aria-invalid={!!isError}
                    className={cn(
                        "w-full justify-start text-left font-normal bg-white",
                        !parsedDate && "text-charcoal-500",
                        isError && "border-red-500 ring-1 ring-red-500 text-red-900 focus-visible:ring-red-500"
                    )}
                >
                    <CalendarIcon className="mr-2 h-4 w-4 opacity-50" />
                    {parsedDate ? format(parsedDate, "MMMM yyyy") : <span>Pick a date</span>}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-3" align="start">
                <div className="flex items-center justify-between pb-3">
                    <Button variant="outline" size="icon" className="h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100" onClick={handlePrevYear}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <div className="text-sm font-medium">{viewYear}</div>
                    <Button variant="outline" size="icon" className="h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100" onClick={handleNextYear}>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                    {months.map((month, idx) => {
                        const isSelected = parsedDate?.getFullYear() === viewYear && parsedDate?.getMonth() === idx;
                        return (
                            <Button
                                key={month}
                                variant={isSelected ? "default" : "ghost"}
                                className={cn(
                                    "h-9 w-full text-sm",
                                    isSelected ? "bg-brand-600 text-white hover:bg-brand-700" : "hover:bg-brand-50 hover:text-brand-900"
                                )}
                                onClick={() => handleMonthSelect(idx)}
                            >
                                {month}
                            </Button>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}
