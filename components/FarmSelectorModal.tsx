import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import HapticPressable from '@/components/HapticPressable';
import { useFarms } from '@/context/FarmsContext';

const Pressable2 = HapticPressable;

type FarmSelectorProps = {
  visible: boolean;
  onClose: () => void;
  onSelect: (farmId: number | null) => void;
  selectedFarmId: number | null;
};

export default function FarmSelectorModal({ visible, onClose, onSelect, selectedFarmId }: FarmSelectorProps) {
  const { farms } = useFarms();

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Pressable2 onPress={onClose}>
              <Ionicons name="close" size={28} color="#2e7d32" />
            </Pressable2>
            <Text style={styles.title}>Select Farm</Text>
            <View style={{ width: 28 }} />
          </View>

          <ScrollView style={styles.list}>
            {/* List of farms */}
            {farms.map((farm) => (
              <Pressable2
                key={farm.id}
                style={[styles.farmOption, selectedFarmId === farm.id && styles.selectedOption]}
                onPress={() => {
                  onSelect(farm.id);
                  onClose();
                }}
              >
                <View style={styles.optionContent}>
                  <Text style={[styles.optionText, selectedFarmId === farm.id && styles.selectedText]}>
                    {farm.farm_name}
                  </Text>
                  <Text style={styles.optionSubtext}>{farm.farm_address}</Text>
                </View>
                {selectedFarmId === farm.id && <Ionicons name="checkmark-circle" size={24} color="#2e7d32" />}
              </Pressable2>
            ))}

            {farms.length === 0 && (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>No farms yet</Text>
                <Text style={styles.emptySubtext}>
                  Create a farm in Profile → Manage Farms to organize your scans
                </Text>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
  },
  list: {
    paddingVertical: 8,
  },
  farmOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  selectedOption: {
    backgroundColor: '#f0fdf4',
  },
  optionContent: {
    flex: 1,
  },
  optionText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  selectedText: {
    color: '#2e7d32',
    fontWeight: '700',
  },
  optionSubtext: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 4,
  },
  emptyState: {
    paddingHorizontal: 16,
    paddingVertical: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#64748b',
  },
  emptySubtext: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 8,
    textAlign: 'center',
  },
});
