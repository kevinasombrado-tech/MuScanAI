import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import HapticPressable from '@/components/HapticPressable';
import { useFarms, type Farm } from '@/context/FarmsContext';

const Pressable2 = HapticPressable;

type FarmManagementModalProps = {
  visible: boolean;
  onClose: () => void;
};

export default function FarmManagementModal({ visible, onClose }: FarmManagementModalProps) {
  const { farms, createFarm, updateFarm, deleteFarm, loading, error } = useFarms();
  const [isAddingOrEditing, setIsAddingOrEditing] = useState(false);
  const [editingFarm, setEditingFarm] = useState<Farm | null>(null);
  const [farmName, setFarmName] = useState('');
  const [farmAddress, setFarmAddress] = useState('');
  const [geotagId, setGeotagId] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAddFarm = () => {
    setEditingFarm(null);
    setFarmName('');
    setFarmAddress('');
    setGeotagId('');
    setIsAddingOrEditing(true);
  };

  const handleEditFarm = (farm: Farm) => {
    setEditingFarm(farm);
    setFarmName(farm.farm_name);
    setFarmAddress(farm.farm_address);
    setGeotagId(farm.geotag_id);
    setIsAddingOrEditing(true);
  };

  const handleSaveFarm = async () => {
    if (!farmName.trim() || !farmAddress.trim() || !geotagId.trim()) {
      Alert.alert('Validation Error', 'Please fill in all fields');
      return;
    }

    setSaving(true);
    try {
      if (editingFarm) {
        const result = await updateFarm(editingFarm.id, farmName, farmAddress, geotagId);
        if (result) {
          Alert.alert('Success', 'Farm updated successfully');
          setIsAddingOrEditing(false);
        } else {
          Alert.alert('Error', 'Failed to update farm');
        }
      } else {
        const result = await createFarm(farmName, farmAddress, geotagId);
        if (result) {
          Alert.alert('Success', 'Farm created successfully');
          setIsAddingOrEditing(false);
        } else {
          Alert.alert('Error', 'Failed to create farm');
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteFarm = (farm: Farm) => {
    Alert.alert('Delete Farm', `Are you sure you want to delete "${farm.farm_name}"?`, [
      { text: 'Cancel', onPress: () => {}, style: 'cancel' },
      {
        text: 'Delete',
        onPress: async () => {
          setSaving(true);
          try {
            const success = await deleteFarm(farm.id);
            if (success) {
              Alert.alert('Success', 'Farm deleted successfully');
            } else {
              Alert.alert('Error', 'Failed to delete farm');
            }
          } finally {
            setSaving(false);
          }
        },
        style: 'destructive',
      },
    ]);
  };

  if (isAddingOrEditing) {
    return (
      <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Pressable2 onPress={() => setIsAddingOrEditing(false)}>
              <Ionicons name="chevron-back" size={28} color="#2e7d32" />
            </Pressable2>
            <Text style={styles.headerTitle}>{editingFarm ? 'Edit Farm' : 'Add Farm'}</Text>
            <View style={{ width: 28 }} />
          </View>

          <ScrollView style={styles.form}>
            <View style={styles.formGroup}>
              <Text style={styles.label}>Farm Name</Text>
              <TextInput
                value={farmName}
                onChangeText={setFarmName}
                placeholder="Enter farm name"
                style={styles.input}
                editable={!saving}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Farm Address</Text>
              <TextInput
                value={farmAddress}
                onChangeText={setFarmAddress}
                placeholder="Enter full address"
                style={[styles.input, styles.textarea]}
                multiline
                numberOfLines={4}
                editable={!saving}
              />
            </View>

            <View style={styles.formGroup}>
              <Text style={styles.label}>Geotag ID</Text>
              <TextInput
                value={geotagId}
                onChangeText={setGeotagId}
                placeholder="Enter geotag ID (GPS/location code)"
                style={styles.input}
                editable={!saving}
              />
            </View>

            {error && <Text style={styles.errorText}>{error}</Text>}
          </ScrollView>

          <View style={styles.formActions}>
            <Pressable2
              style={[styles.button, styles.cancelBtn]}
              onPress={() => setIsAddingOrEditing(false)}
              disabled={saving}
            >
              <Text style={styles.cancelBtnText}>Cancel</Text>
            </Pressable2>
            <Pressable2
              style={[styles.button, styles.saveBtn]}
              onPress={() => void handleSaveFarm()}
              disabled={saving}
            >
              <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save Farm'}</Text>
            </Pressable2>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable2 onPress={onClose}>
            <Ionicons name="close" size={28} color="#2e7d32" />
          </Pressable2>
          <Text style={styles.headerTitle}>Manage Farms</Text>
          <Pressable2 onPress={handleAddFarm} disabled={loading || saving}>
            <Ionicons name="add-circle" size={28} color="#2e7d32" />
          </Pressable2>
        </View>

        {farms.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="leaf-outline" size={64} color="#ccc" />
            <Text style={styles.emptyTitle}>No farms yet</Text>
            <Text style={styles.emptyText}>Add your first farm to get started</Text>
            <Pressable2
              style={[styles.button, styles.primaryBtn]}
              onPress={handleAddFarm}
              disabled={loading || saving}
            >
              <Text style={styles.primaryBtnText}>Add Farm</Text>
            </Pressable2>
          </View>
        ) : (
          <ScrollView style={styles.farmsList}>
            {farms.map((farm, index) => (
              <View key={`${String(farm.id)}-${index}`} style={styles.farmCard}>
                <View style={styles.farmInfo}>
                  <Text style={styles.farmName}>{farm.farm_name}</Text>
                  <Text style={styles.farmAddress}>{farm.farm_address}</Text>
                  <Text style={styles.farmGeotag}>Geotag: {farm.geotag_id}</Text>
                </View>
                <View style={styles.farmActions}>
                  <Pressable2
                    style={styles.actionBtn}
                    onPress={() => handleEditFarm(farm)}
                    disabled={loading || saving}
                  >
                    <Ionicons name="pencil" size={20} color="#165DFF" />
                  </Pressable2>
                  <Pressable2
                    style={styles.actionBtn}
                    onPress={() => handleDeleteFarm(farm)}
                    disabled={loading || saving}
                  >
                    <Ionicons name="trash" size={20} color="#dc2626" />
                  </Pressable2>
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginTop: 16,
  },
  emptyText: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  farmsList: {
    flex: 1,
    padding: 12,
  },
  farmCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  farmInfo: {
    flex: 1,
  },
  farmName: {
    fontSize: 16,
    fontWeight: '700',
  },
  farmAddress: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  farmGeotag: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  farmActions: {
    flexDirection: 'row',
    gap: 8,
    marginLeft: 12,
  },
  actionBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  form: {
    flex: 1,
    padding: 16,
  },
  formGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    backgroundColor: '#fff',
  },
  textarea: {
    textAlignVertical: 'top',
    paddingTop: 12,
  },
  errorText: {
    color: '#dc2626',
    fontSize: 13,
    marginTop: 12,
  },
  formActions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  button: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    backgroundColor: '#2e7d32',
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 12,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelBtn: {
    borderWidth: 1,
    borderColor: '#2e7d32',
    backgroundColor: '#fff',
  },
  cancelBtnText: {
    color: '#2e7d32',
    fontSize: 15,
    fontWeight: '700',
  },
  saveBtn: {
    backgroundColor: '#2e7d32',
  },
  saveBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
