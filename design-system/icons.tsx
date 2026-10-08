/**
 * Lucide icon registry (lucide 0.460.0 — the version pinned by the DS).
 * Icons are referenced by their kebab-case Lucide name, as in the original DS (`<Icon name="arrow-right" />`),
 * but are bundled locally instead of fetched from a CDN at runtime.
 */
import {
  ArrowLeft, ArrowRight, Award, Bell, BookOpen, Bot, Briefcase, CalendarClock, Check, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, CircleAlert, CircleCheck, CircleDot, CirclePlay, ClipboardCheck, ClipboardList, Clock,
  CloudOff, Database, Dumbbell, ExternalLink, Eye, FileStack, FileText, Flag, GraduationCap, Info, LayoutDashboard,
  LayoutTemplate, Library, Lightbulb, ListChecks, Lock, LogOut, Menu, MessageSquareText, PencilRuler, Pencil, Play,
  Plus, Radar, RefreshCw, RotateCw, Route, Search, SearchX, Settings, Shield, Sparkles, Target, Trash2,
  TrendingUp, TriangleAlert, User, Users, X,
  type LucideIcon,
} from "lucide-react";

export const ICONS: Record<string, LucideIcon> = {
  "arrow-left": ArrowLeft, "arrow-right": ArrowRight, award: Award, bell: Bell, "book-open": BookOpen, bot: Bot,
  briefcase: Briefcase, "calendar-clock": CalendarClock, check: Check, "chevron-down": ChevronDown,
  "chevron-left": ChevronLeft, "chevron-right": ChevronRight, "chevron-up": ChevronUp, "circle-alert": CircleAlert,
  "circle-check": CircleCheck, "circle-dot": CircleDot, "circle-play": CirclePlay, "clipboard-check": ClipboardCheck,
  "clipboard-list": ClipboardList, clock: Clock, "cloud-off": CloudOff, database: Database, dumbbell: Dumbbell,
  "external-link": ExternalLink, eye: Eye, "file-stack": FileStack, "file-text": FileText, flag: Flag,
  "graduation-cap": GraduationCap, info: Info, "layout-dashboard": LayoutDashboard,
  "layout-template": LayoutTemplate, library: Library, lightbulb: Lightbulb, "list-checks": ListChecks, lock: Lock,
  "log-out": LogOut, menu: Menu, "message-square-text": MessageSquareText, "pencil-ruler": PencilRuler,
  pencil: Pencil, play: Play, plus: Plus, radar: Radar, "refresh-cw": RefreshCw, "rotate-cw": RotateCw, route: Route,
  search: Search, "search-x": SearchX, settings: Settings, shield: Shield, sparkles: Sparkles, target: Target,
  "trash-2": Trash2, "trending-up": TrendingUp, "triangle-alert": TriangleAlert, user: User, users: Users, x: X,
};

export type IconName = keyof typeof ICONS | (string & {});
