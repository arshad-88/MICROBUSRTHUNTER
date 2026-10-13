import socket
import threading
import time
import scapy.all as scapy

def sender():
    time.sleep(0.3)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    for _ in range(5):
        sock.sendto(b"microburst_test_payload", ("127.0.0.1", 9999))
        time.sleep(0.01)
    sock.close()

def main():
    t = threading.Thread(target=sender)
    t.daemon = True
    t.start()
    
    pkts = scapy.sniff(iface="lo", count=5, timeout=3)
    print(f"Captured {len(pkts)} packets.")
    if pkts:
        print(f"First packet summary: {pkts[0].summary()}")
        p = pkts[0]
        if scapy.IP in p:
            print(f"IP src={p[scapy.IP].src}, dst={p[scapy.IP].dst}, len={len(p)}")
    return len(pkts)

if __name__ == "__main__":
    count = main()
    exit(0 if count > 0 else 1)
