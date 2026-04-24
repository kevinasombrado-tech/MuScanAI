import { View, TouchableOpacity, StyleSheet } from "react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import Feather from "@expo/vector-icons/Feather";
import FontAwesome6 from "@expo/vector-icons/FontAwesome6";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";

const AnimatedTouchableOpacity =
  Animated.createAnimatedComponent(TouchableOpacity);

const PRIMARY_COLOR = "#ffffff";
const SECONDARY_COLOR = "#2e7d32";

const CustomNavBar: React.FC<BottomTabBarProps> = ({
  state,
  descriptors,
  navigation,
}) => {
  const focusedRoute = state.routes[state.index];
  const focusedOptions = descriptors[focusedRoute.key]?.options;
  const focusedTabBarStyle = focusedOptions?.tabBarStyle as { display?: string } | undefined;
  const shouldHide = focusedTabBarStyle?.display === "none";

  if (shouldHide) {
    return null;
  }

  return (
    <View style={styles.container}>
      {state.routes.map((route, index) => {
        if (["_sitemap", "+not-found", "scan_history", "library_entry"].includes(route.name)) return null;

        const { options } = descriptors[route.key];
        const label =
          options.tabBarLabel !== undefined
            ? options.tabBarLabel
            : options.title !== undefined
            ? options.title
            : route.name;

        const isFocused = state.index === index;

        const onPress = () => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
            // Ignore haptics errors on unsupported devices.
          });

          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true,
          });

          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };

        return (
          <AnimatedTouchableOpacity
            layout={LinearTransition.springify().mass(0.5)}
            key={route.key}
            onPress={onPress}
            activeOpacity={0.82}
            style={[
              styles.tabItem,
              { backgroundColor: isFocused ? SECONDARY_COLOR : "transparent" },
            ]}
          >
            {getIconByRouteName(
              route.name,
              isFocused ? PRIMARY_COLOR : SECONDARY_COLOR
            )}
            {isFocused && (
              <Animated.Text
                entering={FadeIn.duration(200)}
                exiting={FadeOut.duration(200)}
                style={styles.text}
              >
                {label as string}
              </Animated.Text>
            )}
          </AnimatedTouchableOpacity>
        );
      })}
    </View>
  );

  function getIconByRouteName(routeName: string, color: string) {
    switch (routeName) {
      case "index":
      case "home":
        return <Feather name="home" size={18} color={color} />;
      case "scan":
        return <Ionicons name="scan-outline" size={18} color={color} />;
      case "library":
        return <Ionicons name="book-outline" size={18} color={color} />;
      case "profile":
        return <FontAwesome6 name="circle-user" size={18} color={color} />;
      default:
        return <Feather name="home" size={18} color={color} />;
    }
  }
};

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: PRIMARY_COLOR,
    width: "94%",
    alignSelf: "center",
    bottom: 30,
    borderRadius: 40,
    paddingHorizontal: 8,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
  },
  tabItem: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    height: 50,
    paddingHorizontal: 30,
    paddingVertical: 10,
    borderRadius: 30,
  },
  text: {
    color: PRIMARY_COLOR,
    marginLeft: 8,
    fontWeight: "500",
  },
});

export default CustomNavBar;
