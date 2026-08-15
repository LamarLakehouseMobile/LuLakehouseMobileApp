import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Dimensions } from 'react-native';
import Animated, { 
  useAnimatedStyle, 
  withSpring, 
  useSharedValue,
  withTiming
} from 'react-native-reanimated';
import { Menu, X, Home, User, LogOut } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { HomeStackParamList } from '../navigation/types';

const { width, height } = Dimensions.get('window');
const DRAWER_WIDTH = width * 0.7; // The navbar takes up 70% of the screen width

export default function SideNavbar() {
  const [isOpen, setIsOpen] = useState(false);
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  // Start the navbar off-screen (Negative Drawer Width)
  const translateX = useSharedValue(-DRAWER_WIDTH);
  // Backdrop opacity starts at 0 (invisible)
  const backdropOpacity = useSharedValue(0);

  const toggleNavbar = () => {
    if (isOpen) {
      // Close: Slide out to the left, fade out backdrop
      translateX.value = withTiming(-DRAWER_WIDTH, { duration: 200 });
      backdropOpacity.value = withTiming(0, { duration: 200 });
    } else {
      // Open: Slide into view (0), fade in backdrop
      translateX.value = withTiming(0, { duration: 200 });
      backdropOpacity.value = withTiming(0.5, { duration: 200 });
    }
    setIsOpen(!isOpen);
  };

  // Animated styles for the sliding menu
  const animatedNavbarStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateX: translateX.value }],
    };
  });

  // Animated styles for the dark background overlay
  const animatedBackdropStyle = useAnimatedStyle(() => {
    return {
      opacity: backdropOpacity.value,
      // Prevents clicking through the backdrop when it's invisible
      pointerEvents: backdropOpacity.value === 0 ? 'none' : 'auto',
    };
  });

  return (
    <View style={styles.container} pointerEvents={isOpen ? 'auto' : 'box-none'}>
      {/* Trigger Button (Top Left) */}
      <TouchableOpacity onPress={toggleNavbar} style={styles.menuButton}>
        <Menu size={28} color="#1E293B" />
      </TouchableOpacity>

      {/* Dimmed Backdrop overlay */}
      <Animated.View style={[styles.backdrop, animatedBackdropStyle]}>
        <TouchableOpacity style={styles.flexOne} onPress={toggleNavbar} activeOpacity={1} />
      </Animated.View>

      {/* Sliding Side Navbar */}
      <Animated.View style={[styles.sidebar, animatedNavbarStyle]}>
        <View style={styles.sidebarHeader}>
          <Text style={styles.logoText}>Menu</Text>
          <TouchableOpacity onPress={toggleNavbar}>
            <X size={24} color="#64748B" />
          </TouchableOpacity>
        </View>

        {/* Navigation Links */}
        <View style={styles.navItems}>
          <TouchableOpacity onPress={() => navigation.navigate("Home")} style={styles.navLink}>
            <Home size={22} color="#64748B" />
            <Text style={styles.navText}>Home</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate("Profile")} style={styles.navLink}>
            <User size={22} color="#64748B" />
            <Text style={styles.navText}>Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate("Logout")} style={[styles.navLink, styles.logout]}>
            <LogOut size={22} color="#EF4444" />
            <Text style={[styles.navText, styles.logoutText]}>Logout</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
    zIndex: 999,
  },
  flexOne: {
    flex: 1,
  },
  menuButton: {
    position: 'absolute',
    top: 40,
    left: 20,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
    zIndex: 10,
  },
  sidebar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    height: height,
    backgroundColor: '#FF3B30', // Red navbar background
    zIndex: 20, // Sits above the backdrop
    padding: 24,
    paddingTop: 60,
    // Adds depth shadow behind the edge
    shadowColor: '#000',
    shadowOffset: { width: 5, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 16,
  },
  sidebarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 40,
  },
  logoText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: 'bold',
  },
  navItems: {
    gap: 20,
  },
  navLink: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 16,
  },
  navText: {
    color: '#E2E8F0',
    fontSize: 16,
    fontWeight: '500',
  },
  logout: {
    marginTop: 40,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 20,
  },
  logoutText: {
    color: '#EF4444',
  },
});