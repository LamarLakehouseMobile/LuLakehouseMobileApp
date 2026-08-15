import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import TeachableMachineScreen from '../screens/TeachableMachineScreen';
import ProjectTypeScreen from '../screens/ProjectTypeScreen';
import AudioTrainingScreen from '../screens/AudioTrainingScreen';
import ImageTrainingScreen from '../screens/ImageTrainingScreen';
import ViewSamplesScreen from '../screens/ViewSamplesScreen';
import ViewImagesScreen from '../screens/ViewImagesScreen';
import LiveCameraScreen from '../screens/LiveCameraScreen';
import LiveAudioScreen from '../screens/LiveAudioScreen';
import ProfileScreen from '../screens/ProfileScreen';


const Stack = createNativeStackNavigator();

export default function HomeNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Profile" component={ProfileScreen} />
      <Stack.Screen name="TeachableMachine" component={TeachableMachineScreen} />
      <Stack.Screen name="ProjectType" component={ProjectTypeScreen} />
      <Stack.Screen name="AudioTraining" component={AudioTrainingScreen} />
      <Stack.Screen name="ViewSamples" component={ViewSamplesScreen} />
      <Stack.Screen name="ImageTraining" component={ImageTrainingScreen} />
      <Stack.Screen name="ViewImages" component={ViewImagesScreen} />
      <Stack.Screen name="LiveCamera" component={LiveCameraScreen} />
      <Stack.Screen name="LiveAudio" component={LiveAudioScreen} />
    </Stack.Navigator>
  );
}
