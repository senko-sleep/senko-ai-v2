import {
  Atom, Bike, BookOpen, Brain, Briefcase, Bug, Calculator, Calendar, Camera, Car, Cat, ChartLine, ChefHat, Clapperboard,
  Clock, CloudSun, Code, Coffee, Compass, Cpu, Dog, Drama, Dumbbell, Feather, Film, FlaskConical, Flower2, Gamepad2,
  Ghost, Gift, Globe, GraduationCap, Headphones, HeartPulse, House, Image, Landmark, Languages, Leaf, Lightbulb, ListChecks,
  Mail, Map, MessageCircle, Mic, Moon, Mountain, Music, Newspaper, Palette, PawPrint, PenLine, Pizza, Plane, Play,
  Popcorn, Puzzle, Rocket, ScrollText, Search, Shirt, ShoppingBag, Smartphone, Sparkles, Sprout, Star, Sun, Swords,
  Telescope, Terminal, Trophy, Tv, Utensils, Wallet, WandSparkles, Zap,
  type LucideIcon,
} from "lucide-react";
import type { SuggestionIcon as IconName } from "@/lib/suggestion-icons";

const ICONS: Record<IconName, LucideIcon> = {
  sparkles: Sparkles, lightbulb: Lightbulb, "book-open": BookOpen, "graduation-cap": GraduationCap, code: Code,
  terminal: Terminal, bug: Bug, palette: Palette, "pen-line": PenLine, music: Music, headphones: Headphones, film: Film,
  tv: Tv, gamepad: Gamepad2, camera: Camera, image: Image, map: Map, plane: Plane, compass: Compass, mountain: Mountain,
  utensils: Utensils, "chef-hat": ChefHat, coffee: Coffee, dumbbell: Dumbbell, "heart-pulse": HeartPulse, leaf: Leaf,
  sprout: Sprout, sun: Sun, moon: Moon, "cloud-sun": CloudSun, rocket: Rocket, atom: Atom, flask: FlaskConical,
  telescope: Telescope, brain: Brain, calculator: Calculator, chart: ChartLine, wallet: Wallet, briefcase: Briefcase,
  calendar: Calendar, "list-checks": ListChecks, clock: Clock, mail: Mail, message: MessageCircle, languages: Languages,
  globe: Globe, newspaper: Newspaper, "shopping-bag": ShoppingBag, gift: Gift, house: House, car: Car, bike: Bike,
  dog: Dog, cat: Cat, "paw-print": PawPrint, trophy: Trophy, puzzle: Puzzle, wand: WandSparkles, feather: Feather,
  scroll: ScrollText, mic: Mic, play: Play, search: Search, clapperboard: Clapperboard, swords: Swords, shirt: Shirt,
  flower: Flower2, star: Star, zap: Zap, cpu: Cpu, smartphone: Smartphone, landmark: Landmark, pizza: Pizza,
  ghost: Ghost, popcorn: Popcorn, drama: Drama,
};

/** Renders a suggestion's icon by name; unknown names fall back to the sparkle. */
export function SuggestionIcon({ name, size = 18 }: { name: string; size?: number }) {
  const Icon = ICONS[name as IconName] || Sparkles;
  return <Icon size={size} strokeWidth={1.9} aria-hidden />;
}
