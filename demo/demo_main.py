import pymikro


def demo_lights(maschine):
    state = {
        "button": {
            "stop": {"val": 1},
        },
        "strip": {
            1: {"val": 3, "color": "blue"},
        },
        "pad": {
            0: {"val": 10, "color": "green"},
        },
    }
    maschine.lights.set_all(state)

    maschine.lights.set("pad", 6, 3, "orange")
    maschine.lights.set("strip", 5, 3, "green")
    maschine.lights.set("button", "notes", 3)
    maschine.lights.update()


def demo_screen(maschine):
    maschine.screen.set("Hello World!\nIt's working")


def demo_btn_pad(maschine):
    while True:
        cmd = maschine.read_cmd()
        if cmd:
            if cmd["cmd"] == "pad":
                print(
                    "Pad number {} pressed with value: {}".format(
                        cmd["pad_nb"], cmd["pad_val"]
                    )
                )
                maschine.lights.set("pad", cmd["pad_nb"], 2, "red")
            if cmd["cmd"] == "btn":
                # da steht auch encoder und strip drin.
                # {'cmd': 'btn', 'btn_pressed': [], 'encoder_pos': 4, 'encoder_move': 0, 'encoder_touched': False, 'strip_pos_1': 40, 'strip_pos_2': 0}
                # {'cmd': 'btn', 'btn_pressed': ['solo'], 'encoder_pos': 4, 'encoder_move': 0, 'encoder_touched': False, 'strip_pos_1': 0, 'strip_pos_2': 0}
                print(cmd)
                # print("Buttons pressed: {}".format(cmd["btn_pressed"]))
                # maschine.lights.set("button", cmd["btn_pressed"][0], 3)
                if cmd['btn_pressed']:  # checks if list is not empty
                    pressed_btn = cmd['btn_pressed'][0]
                    maschine.lights.set("button", pressed_btn, 3)
                # maschine.lights.set("button", "mute", 3)
        maschine.lights.update()


if __name__ == "__main__":
    maschine = pymikro.MaschineMikroMk3()

    demo_lights(maschine)
    demo_screen(maschine)
    demo_btn_pad(maschine)
